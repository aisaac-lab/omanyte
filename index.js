#!/usr/bin/env node
'use strict'
const net = require('net')
const Socket = net.Socket
const HTTPParser = process.binding('http_parser').HTTPParser

class HTTPServerAsyncResource {
  constructor(type, socket) {
    this.type = type
    this.socket = socket
  }
}

const main = () => {
  const slice_count = 2
  const argv = process.argv.slice(slice_count)
  let cfg = {}
  argv.forEach((arg, i) => {
    if ((i % 2 === 0) && (arg.slice(0, 1) === '-')) {
      cfg[arg.slice(1)] = argv[i + 1]
    }
  })
  
  cfg.local_host = cfg.local_host || 'localhost'
  cfg.local_port = (cfg.local_port & 0xffff) || 8080
  cfg.remote_port = (cfg.remote_port & 0xffff) || 8080
  
  if (!cfg.local_host || !cfg.local_port || !cfg.remote_host || !cfg.remote_port || !cfg.usr || !cfg.pwd) {
    return console.error('Usage of parameters:\n'
      + '-local_host host\t' + 'Listening address. Default: localhost. (* means all interfaces)\n'
      + '-local_port port\t' + 'Listening port. Default: 8080\n'
      + '-remote_host host\t' + 'Real proxy/PAC server address\n'
      + '-remote_port port\t' + 'Real proxy/PAC server port. Default: 8080\n'
      + '-usr user\t\t' + 'Real proxy/PAC server user id\n'
      + '-pwd password\t\t' + 'Real proxy/PAC user password\n'
    )
  }

  console.log('Using parameters: ' + JSON.stringify(cfg, null, '  '))
  createPortForwarder(cfg)
}

const CR = 0xd, LF = 0xa
const BUF_CR_LF_CR_LF = Buffer.from([CR, LF, CR, LF]),
      BUF_LF_LF = Buffer.from([LF, LF])
const STATE_NONE = 0, STATE_FOUND_LF = 1, STATE_FOUND_LF_CR = 2

const createPortForwarder = cfg => {
  const { local_host, local_port, remote_host, remote_port, usr, pwd } = cfg
  const buf_proxy_basic_auth = 
    Buffer.from('Proxy-Authorization: Basic ' + Buffer.from(usr + ':' + pwd).toString('base64'))
  const foward_label = `http://${local_host}:${local_port} => http://${remote_host}:${remote_port}`

  net.createServer({ allowHalfOpen: true }, function (socket) {
    const realCon = net.connect({
      port: remote_port, host: remote_host, allowHalfOpen: true,
    })
    realCon.on('data', buf => {
      socket.write(buf)
      realCon.__haveGotData = true
    }).on('end', () => {
      socket.end()
      console.log(foward_label)
      if (!realCon.__haveGotData && !realCon.__haveShownError) {
        console.error('[LocalProxy(:' + local_port + ')][Connection to ' + remote_host + ':' + remote_port + '] Error: ended by remote peer')
        realCon.__haveShownError = true
      }
    }).on('close', () => {
      socket.end()
      if (!realCon.__haveGotData && !realCon.__haveShownError) {
        console.error('[LocalProxy(:' + local_port + ')][Connection to ' + remote_host + ':' + remote_port + '] Error: reset by remote peer')
        realCon.__haveShownError = true
      }
    }).on('error', err => {
      console.error('[LocalProxy(:' + local_port + ')][Connection to ' + remote_host + ':' + remote_port + '] ' + err)
      realCon.__haveShownError = true
    })

    let parser = new HTTPParser(HTTPParser.REQUEST)
    parser.initialize(
      HTTPParser.REQUEST,
      new HTTPServerAsyncResource('HTTPINCOMINGMESSAGE', new Socket())
    )
    
    parser[HTTPParser.kOnHeadersComplete] = function (versionMajor, versionMinor, headers, method,
                                                      url, statusCode, statusMessage, upgrade,
                                                      shouldKeepAlive) {
      //console.log('---- kOnHeadersComplete----');
      //console.log(arguments);
      parser.__is_headers_complete = true
      parser.__upgrade = upgrade
      parser.__method = method
    }
    // parser[HTTPParser.kOnMessageComplete] = function () {
    //    console.log('---- kOnMessageComplete----');
    //    console.log(arguments);
    // };
    const cleanup = () => {
      socket.__cleanup = true
      if (parser) {
        parser.close()
        parser = null
      }
      realCon.end()
    }

    let state = STATE_NONE

    socket.on('data', function (buf) {
      if (!parser) {
        realCon.write(buf)
        return
      }
      // console.log(`${remote_host}:${remote_port}@${new Date().getTime()}\n${buf.toString('ascii')}`)
      // let ret = parser.execute(buf)
      // console.log('\n\n----parser result: ' + ret + ' buf len:' + buf.length)
      //realCon.write(buf);
      //return;

      var buf_ary = [], unsavedStart = 0, buf_len = buf.length

      for (var i = 0; i < buf_len; i++) {
        //find first LF
        if (state === STATE_NONE) {
          if (buf[i] === LF) {
            state = STATE_FOUND_LF
          }
          continue
        }

        //find second CR LF or LF
        if (buf[i] === LF) {
          parser.__is_headers_complete = false
          parser.execute(buf.slice(unsavedStart, i + 1))

          if (parser.__is_headers_complete) {
            buf_ary.push(buf.slice(unsavedStart, buf[i - 1] === CR ? i - 1 : i))
            buf_ary.push(buf_proxy_basic_auth)
            buf_ary.push(state === STATE_FOUND_LF_CR ? BUF_CR_LF_CR_LF : BUF_LF_LF)

            // stop intercepting packets if encountered TLS and WebSocket handshake
            if (parser.__method === 5 /*CONNECT*/ || parser.__upgrade) {
              parser.close()
              parser = null

              buf_ary.push(buf.slice(i + 1))
              realCon.write(Buffer.concat(buf_ary))

              state = STATE_NONE
              return
            }

            unsavedStart = i + 1
            state = STATE_NONE
          }
          else {
            state = STATE_FOUND_LF
          }
        }
        else if (buf[i] === CR && state === STATE_FOUND_LF) {
          state = STATE_FOUND_LF_CR
        } else {
          state = STATE_NONE
        }
      }

      if (unsavedStart < buf_len) {
        buf = buf.slice(unsavedStart, buf_len)
        parser.execute(buf)
        buf_ary.push(buf)
      }

      realCon.write(Buffer.concat(buf_ary))

    }).on('end', cleanup).on('close', cleanup).on('error', (err) => {
      if (!socket.__cleanup) {
        console.error('[LocalProxy(:' + local_port + ')][Incoming connection] ' + err)
      }
    })
  }).on('error', (err) => {
    console.error('[LocalProxy(:' + local_port + ')] ' + err)
    process.exit(1)
  }).listen(local_port, local_host === '*' ? undefined : local_host, function () {
    console.log(`[start] ${foward_label}`)
  })
}

main()
