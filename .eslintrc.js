module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
    jest: true,
  },
  extends: [
    'eslint:recommended'
  ],
  rules: {
    'arrow-parens': ['error', 'as-needed'],
    'array-bracket-spacing': ['error', 'never'],
    'comma-dangle': ['error', 'always-multiline'],
    'comma-spacing': ['error', { before: false, after: true }],
    'eol-last': ['error', 'always'],
    eqeqeq: ['error', 'smart'],
    'linebreak-style': ['error', 'unix'],
    'max-len': ['error', { code: 150 }],
    'object-curly-spacing': ['error', 'always'],
    'no-implicit-coercion': ['error', { boolean: false }],
    'object-shorthand': ['error', 'always'],
    quotes: ['error', 'single'],
    'quote-props': ['error', 'as-needed'],
    semi: ['error', 'never'],
  }
}