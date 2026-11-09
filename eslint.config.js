import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'
import hooks from 'eslint-plugin-react-hooks'
export default tseslint.config(
  { ignores: ['src/components/ui/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: { ...globals.browser, ...globals.node } }, plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } },
)
