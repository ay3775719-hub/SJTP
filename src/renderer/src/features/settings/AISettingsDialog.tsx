import { useEffect, useMemo, useState } from 'react'
import { ArrowClockwise, CheckCircle, Cloud, Cpu, HardDrives, Key, LockKey, Pause, Play, PlugsConnected, SignOut, Sparkle, WarningCircle, X } from '@phosphor-icons/react'
import type { AIProviderId, AIRunMode, WebCollectorStatus } from '@shared/types/domain'
import { useAIStore } from '../../stores/useAIStore'
import { useVisualSimilarityStore } from '../../stores/useVisualSimilarityStore'
import { museApi } from '../../api/client'

const MODE_COPY: Record<AIRunMode, { label: string; provider: AIProviderId }> = {
  'local-only': { label: '本地', provider: 'ollama' },
  'cloud-only': { label: '云端', provider: 'codex-chatgpt' },
  manual: { label: '自定义', provider: 'openai-compatible' }
}

export function AISettingsDialog(): React.JSX.Element | null {
  const store = useAIStore()
  const visual = useVisualSimilarityStore()
  const [secret, setSecret] = useState('')
  useEffect(() => { if (!store.settingsOpen) setSecret('') }, [store.settingsOpen])
  const settings = store.settings
  const provider = store.providers.find((item) => item.id === settings?.providerId)
  const config = settings?.providerConfigs[settings.providerId]
  const health = settings ? store.health[settings.providerId] : undefined
  const models = useMemo(() => settings ? (store.models[settings.providerId] ?? []).filter((model) => model.capabilities.vision) : [], [settings, store.models])
  if (!store.settingsOpen || !settings || !provider || !config) return null

  const isCodex = settings.providerId === 'codex-chatgpt'
  const selectMode = (runMode: AIRunMode): void => {
    const providerId = MODE_COPY[runMode].provider
    void store.updateSettings({ runMode, providerId, concurrency: 1 })
    void store.refreshModels(providerId)
    if (providerId === 'codex-chatgpt') void store.refreshCodex()
  }
  const selectProvider = (providerId: AIProviderId): void => {
    void store.updateSettings({ providerId, concurrency: providerId === 'codex-chatgpt' ? 1 : settings.concurrency })
    void store.refreshModels(providerId)
    if (providerId === 'codex-chatgpt') void store.refreshCodex()
  }
  const updateConfig = (patch: Partial<typeof config>): void => { void store.updateSettings({ providerConfigs: { [settings.providerId]: { ...config, ...patch } } }) }
  const allowedProviders = store.providers.filter((item) => settings.runMode === 'local-only' ? item.kind === 'local' : settings.runMode === 'cloud-only' ? item.kind === 'cloud' : item.kind === 'custom')
  const needsSecret = !isCodex && (provider.requiresApiKey || provider.kind === 'custom')
  const statusTone = isCodex ? (store.codexAccount?.connected ? 'connected' : 'disconnected') : health?.status === 'connected' ? 'connected' : health ? 'disconnected' : 'unknown'
  const activeQueue = store.queue.queued + store.queue.analyzing

  return <div className="smart-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) store.closeSettings() }}>
    <section className="ai-settings-modal ai-provider-settings" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
      <header><div><h2 id="ai-settings-title">AI 设置</h2><p>Codex / ChatGPT 使用官方托管登录，不需要 OpenAI API Key。</p></div><button onClick={store.closeSettings} aria-label="关闭"><X size={18} /></button></header>
      <div className="ai-settings-content">
        <div className="settings-group"><span className="settings-group-label">AI 模式</span><div className="ai-mode-switch">{(Object.keys(MODE_COPY) as AIRunMode[]).map((mode) => <button key={mode} className={settings.runMode === mode ? 'active' : ''} onClick={() => selectMode(mode)}>{mode === 'local-only' ? <Cpu size={15} /> : mode === 'cloud-only' ? <Cloud size={15} /> : <PlugsConnected size={15} />}{MODE_COPY[mode].label}</button>)}</div></div>
        <div className="settings-field"><span>AI 引擎</span><select value={settings.providerId} onChange={(event) => selectProvider(event.target.value as AIProviderId)}>{allowedProviders.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === 'codex-chatgpt' ? ' · 推荐' : ` · ${item.kind === 'local' ? '本地' : item.kind === 'cloud' ? '云端' : '自定义'}`}</option>)}</select></div>

        {isCodex && <div className="credential-panel codex-account-panel">
          <div className="credential-status">{store.codexAccount?.connected ? <><CheckCircle size={17} weight="fill" />Codex 已连接</> : <><Sparkle size={17} />Codex 未登录</>}</div>
          {store.codexAccount?.connected ? <>
            <div className="codex-account-details"><span>账号</span><strong>{store.codexAccount.email ?? 'ChatGPT'}</strong><span>计划</span><strong>{store.codexAccount.planType ?? '未知'}</strong></div>
            <button className="clear-key" onClick={() => void store.logoutCodex()}><SignOut size={14} />退出登录</button>
          </> : <div className="codex-login-actions">
            <button className="primary" onClick={() => void store.loginCodex(false)}>使用 ChatGPT 登录</button>
            <button onClick={() => void store.loginCodex(true)}>使用设备代码登录</button>
          </div>}
          {store.codexLogin?.type === 'chatgptDeviceCode' && <p className="codex-device-code">设备代码：<strong>{store.codexLogin.userCode}</strong><br />浏览器已打开官方登录页面。</p>}
          {store.codexUsage?.primary && <div className="codex-usage"><span>Codex 使用额度</span><strong>{Math.round(store.codexUsage.primary.usedPercent)}%</strong><div><i style={{ width: `${Math.min(100, store.codexUsage.primary.usedPercent)}%` }} /></div></div>}
        </div>}

        {!isCodex && (provider.kind !== 'cloud' || settings.providerId === 'openai-compatible') && <div className="settings-field"><span>服务地址</span><input value={config.baseUrl} spellCheck={false} onChange={(event) => updateConfig({ baseUrl: event.target.value })} /></div>}
        {settings.providerId === 'openai-compatible' && <div className="settings-field"><span>名称</span><input value={config.displayName ?? ''} placeholder="自定义视觉服务" onChange={(event) => updateConfig({ displayName: event.target.value })} /></div>}
        {!isCodex && <div className="provider-status-row"><div className={`provider-health ${statusTone}`}><span />{health?.message ?? (provider.kind === 'local' ? '正在检测本地服务…' : '尚未测试连接')}</div><button disabled={store.loadingProvider} onClick={() => void store.testConnection(settings.providerId)}><PlugsConnected size={15} />测试连接</button></div>}
        {isCodex && <div className={`provider-health ${statusTone}`}><span />{store.codexAccount?.connected ? '官方 ChatGPT managed authentication' : '登录后可读取支持图片输入的 Codex 模型'}</div>}

        <div className="settings-field"><span>图片识别模型</span><select value={config.modelId || 'auto'} onChange={(event) => updateConfig({ modelId: event.target.value })}><option value="auto">自动选择推荐模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ' · 推荐' : ''}</option>)}</select></div>
        <div className="provider-actions"><button disabled={store.loadingProvider || (isCodex && !store.codexAccount?.connected)} onClick={() => void store.refreshModels(settings.providerId)}><ArrowClockwise size={14} className={store.loadingProvider ? 'spinning' : ''} />刷新模型</button><small>只显示确认支持图片输入的模型；批量识别使用 low reasoning。</small></div>

        {needsSecret && <div className="credential-panel"><div className="credential-status">{settings.secretConfigured ? <><CheckCircle size={17} weight="fill" />凭据已安全保存</> : <><Key size={17} />{provider.requiresApiKey ? '需要 API Key' : 'API Key 可选'}</>}</div>{!settings.secretConfigured ? <div className="credential-input"><input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="输入此 Provider 的 Key" /><button disabled={!secret.trim()} onClick={() => void store.setProviderSecret(settings.providerId, secret)}>安全保存</button></div> : <button className="clear-key" onClick={() => void store.clearProviderSecret(settings.providerId)}>移除此 Provider 的 Key</button>}<small><LockKey size={13} />不同 Provider 的凭据独立加密保存，不会进入 Renderer 或 localStorage。</small></div>}

        <label className="settings-toggle"><span><strong>启用 AI 分析</strong><small>允许手动把素材加入现有分析队列</small></span><input type="checkbox" checked={settings.enabled} onChange={(event) => void store.updateSettings({ enabled: event.target.checked })} /></label>
        <label className="settings-toggle"><span><strong>导入新素材后自动识别</strong><small>默认关闭，避免一次导入大量素材后自动消耗 Codex 使用额度</small></span><input type="checkbox" checked={settings.autoAnalyzeOnImport} onChange={(event) => void store.updateSettings({ autoAnalyzeOnImport: event.target.checked })} /></label>

        {activeQueue > 0 && <div className="codex-queue-panel"><div><strong>{store.queue.providerId === 'codex-chatgpt' ? 'Codex 图片识别' : 'AI 分析队列'}</strong><span>完成 {store.queue.completed} · 分析中 {store.queue.analyzing} · 等待 {store.queue.queued} · 失败 {store.queue.failed}</span></div><button onClick={() => void (store.queue.paused ? store.resumeQueue() : store.pauseQueue())}>{store.queue.paused ? <Play size={14} /> : <Pause size={14} />}{store.queue.paused ? '继续' : '暂停'}</button>{store.queue.paused && <p>{queuePauseCopy(store.queue.pauseReason)}</p>}</div>}

        {provider.kind === 'cloud' ? <label className="privacy-consent"><input type="checkbox" checked={settings.cloudPrivacyAccepted} onChange={(event) => void store.updateSettings({ cloudPrivacyAccepted: event.target.checked })} /><span><strong>云端 AI</strong><br />分析时，Muse 会将用于分析的缩放版本发送给所选 AI 服务。Codex / ChatGPT 会使用当前账号的 Codex 使用额度；不会自动切换到付费 API。</span></label> : <div className="local-privacy"><Cpu size={16} /><span><strong>{provider.kind === 'local' ? '本地 AI' : '自定义 Endpoint'}</strong><br />{provider.kind === 'local' ? 'Muse 将分析图片发送到你配置的本机服务，不会自动回退到收费云端 Provider。' : '图片将发送到你填写的 Endpoint；请确认该服务由你信任。'}</span></div>}
        <VisualIndexSettings />
        <WebCollectorSettings />
        {store.error && <p className="settings-error">{store.error}</p>}
        {visual.error && <p className="settings-error">{visual.error}</p>}
      </div>
      <footer><button className="primary" onClick={store.closeSettings}>完成</button></footer>
    </section>
  </div>
}

function WebCollectorSettings(): React.JSX.Element {
  const [status, setStatus] = useState<WebCollectorStatus | null>(null)
  const refresh = (): void => { void museApi.webCollector.status().then(setStatus) }
  useEffect(refresh, [])
  return <section className="visual-index-settings">
    <div className="visual-index-settings-title"><div><PlugsConnected size={17} /><span><strong>浏览器采集</strong><small>Chrome / Edge · 本机安全连接</small></span></div><em className={status?.running ? 'ready' : ''}>{status?.running ? '已就绪' : '未连接'}</em></div>
    <div className="visual-index-model"><span>桥接</span><strong>127.0.0.1:{status?.port ?? 47831}</strong><span>协议</span><strong>v{status?.protocolVersion ?? 1}</strong><span>已配对</span><strong>{status?.pairedBrowsers.length ?? 0}</strong></div>
    {status?.pairedBrowsers.map((browser) => <div className="provider-status-row" key={browser.extensionId}><div className="provider-health connected"><span />{browser.browserName} · {browser.extensionId.slice(0, 8)}…</div><button onClick={async () => { await museApi.webCollector.revoke(browser.extensionId); refresh() }}>撤销</button></div>)}
    <div className="provider-actions"><button onClick={refresh}><ArrowClockwise size={14} />刷新连接</button></div>
    <div className="local-privacy"><LockKey size={16} /><span>采集只在你右键选择图片后发生。Muse 不读取浏览历史或 Cookie；网页采集本身不消耗 Codex 额度。</span></div>
  </section>
}

function VisualIndexSettings(): React.JSX.Element {
  const visual = useVisualSimilarityStore(), status = visual.status
  if (!status) return <section className="visual-index-settings"><strong>视觉索引</strong><span>正在读取状态…</span></section>
  const preparing = status.modelState === 'preparing'
  const active = status.queued + status.generating
  return <section className="visual-index-settings">
    <div className="visual-index-settings-title"><div><HardDrives size={17} /><span><strong>视觉索引</strong><small>用于“查找相似图片”，100% 本地运行</small></span></div><em className={status.modelState === 'ready' ? 'ready' : ''}>{status.modelState === 'ready' ? '已就绪' : status.modelState === 'preparing' ? '准备中' : status.modelState === 'failed' ? '需要重试' : '未准备'}</em></div>
    <div className="visual-index-model"><span>模型</span><strong>{status.modelName}</strong><span>索引</span><strong>{status.completed} / {status.totalEligible}</strong><span>占用</span><strong>{formatBytes(status.modelBytes + status.completed * status.embeddingDimension * 4)}</strong></div>
    {preparing && <div className="visual-model-progress"><div><i style={{ width: `${Math.round((status.preparingProgress ?? 0) * 100)}%` }} /></div><span>正在准备模型… {Math.round((status.preparingProgress ?? 0) * 100)}%</span></div>}
    {status.modelState !== 'ready' ? <button className="visual-index-primary" disabled={preparing || visual.loading} onClick={() => void visual.prepare()}>{preparing ? '正在准备…' : '准备本地视觉模型'}</button> : <>
      <label className="settings-toggle"><span><strong>导入后自动生成视觉索引</strong><small>本地后台计算，不消耗 Codex 或 API 额度</small></span><input type="checkbox" checked={status.autoIndexOnImport} onChange={(event) => void visual.updateAutoIndex(event.target.checked)} /></label>
      <div className="provider-actions"><button disabled={!active} onClick={() => void (status.paused ? visual.resume() : visual.pause())}>{status.paused ? <Play size={14} /> : <Pause size={14} />}{status.paused ? '继续' : '暂停'}</button><button disabled={visual.loading} onClick={() => void visual.rebuild()}><ArrowClockwise size={14} />重新建立全部索引</button></div>
    </>}
    <div className="local-privacy"><Cpu size={16} /><span>视觉相似搜索在本机运行。图片不会为了此功能上传到 Codex 或其他云端 Provider。</span></div>
  </section>
}

export function AIQueueStatusBar(): React.JSX.Element | null {
  const queue = useAIStore((state) => state.queue), openSettings = useAIStore((state) => state.openSettings)
  const active = queue.queued + queue.analyzing
  if (!active && !queue.failed) return null
  const label = queue.providerId === 'codex-chatgpt' ? 'Codex AI' : 'AI 分析'
  return <button className={`ai-queue-status ${queue.paused ? 'paused' : ''}`} onClick={openSettings}>{queue.paused ? <><Pause size={13} />{label} 已暂停 · 剩余 {queue.queued}</> : active ? <><span className="ai-mini-spinner" />{label} {queue.completed} / {queue.completed + active}</> : `${label} 失败 ${queue.failed}`}</button>
}

export function VisualIndexStatusBar(): React.JSX.Element | null {
  const status = useVisualSimilarityStore((state) => state.status)
  const loading = useVisualSimilarityStore((state) => state.loading)
  if (!status || status.modelState === 'not_installed') return null
  if (status.modelState === 'failed' || status.failed > 0) return <button className="visual-index-status failed" title={status.lastError ?? '部分素材的本地视觉索引生成失败'} onClick={() => useAIStore.getState().openSettings()}><WarningCircle size={13} />视觉索引需要处理 · 失败 {status.failed}</button>
  if (status.modelState === 'preparing') return <button className="visual-index-status"><span className="ai-mini-spinner" />准备视觉模型 {Math.round((status.preparingProgress ?? 0) * 100)}%</button>
  if (!status.queued && !status.generating && !loading) return null
  return <button className={`visual-index-status ${status.paused ? 'paused' : ''}`} onClick={() => void (status.paused ? useVisualSimilarityStore.getState().resume() : useVisualSimilarityStore.getState().pause())}>{status.paused ? <Pause size={13} /> : <span className="ai-mini-spinner" />}视觉索引 {status.completed} / {status.totalEligible}</button>
}

function formatBytes(bytes: number): string { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB` }

function queuePauseCopy(reason: string | null | undefined): string {
  if (reason === 'usage_limit') return 'Codex 当前使用额度已达到限制；额度恢复后可继续。'
  if (reason === 'auth_required') return 'Codex 登录已失效；重新登录后可继续。'
  if (reason === 'service_unavailable') return 'Codex App Server 暂时不可用；重新连接后可继续。'
  if (reason === 'restart_checkpoint') return '上次 Codex 识别任务尚未完成。Muse 不会自动继续消耗额度。'
  return '队列已暂停，当前批次完成后不会启动新批次。'
}
