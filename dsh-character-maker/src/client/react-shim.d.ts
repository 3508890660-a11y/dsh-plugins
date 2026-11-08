/**
 * 最小 react 类型声明（web 端运行时由 ModuleLoader 提供 require("react")，
 * 构建链无 @types/react——这里只声明用到的面）。
 */
declare module 'react' {
  export type ReactNode = any
  export type CSSProperties = Record<string, string | number | undefined>
  export function createElement(type: any, props?: any, ...children: any[]): any
  export function useState<S>(initial: S | (() => S)): [S, (v: S | ((prev: S) => S)) => void]
  export function useRef<T>(initial: T): { current: T }
  export function useMemo<T>(factory: () => T, deps?: readonly any[]): T
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void
  export const Fragment: any
}