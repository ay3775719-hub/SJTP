import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error): { error: Error } { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('Renderer crashed', error, info) }
  render(): ReactNode {
    if (this.state.error) return <div className="fatal-error"><strong>Muse 无法显示这个页面</strong><p>{this.state.error.message}</p><button onClick={() => window.location.reload()}>重新载入</button></div>
    return this.props.children
  }
}
