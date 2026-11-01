import 'i18next'
import type en from './en.json'

// Makes a mistyped key a type error rather than text buyers see.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
