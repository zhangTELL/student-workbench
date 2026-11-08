<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChatDotRound, Clock, Close, Delete, Setting, Position, RefreshLeft, Check, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { AssistantSession, AssistantTarget, AssistantTurn } from '@wb/shared'
import { assistant, deleteAssistantSession, loadAssistant, openAssistantChat, resolveAssistant, switchAssistantSession, sendAssistant, targetLocation } from '../stores/assistant'
import { hasUnsavedEdits } from '../composables/useUnsavedChanges'
import AssistantSettings from './AssistantSettings.vue'
import PanelDivider from './PanelDivider.vue'
import { assistantLayout } from '../stores/assistantLayout'

const route = useRoute()
const router = useRouter()
const settingsTab = 'settings'
const tabs = ref<string[]>([])
const historyVisible = ref(false)
const tabList = ref<HTMLElement>()
const configVisible = computed(() => assistant.view === 'settings')
const activeTab = computed(() => configVisible.value ? settingsTab : assistant.state.sessionId)
const sessionBusy = computed(() => assistant.sending || assistant.state.busy || assistant.switching)
const chatTabCount = computed(() => tabs.value.filter(id => id !== settingsTab).length)
const messagesEl = ref<HTMLElement>()
const localMessage = ref('')
const following = ref(true)
const width = toRef(assistantLayout, 'width')
const viewportWidth = ref(window.innerWidth)
const maxWidth = computed(() => Math.max(320, viewportWidth.value - 560))
const name = computed(() => assistant.config?.name || 'AI助手')
const canSend = computed(() => !!assistant.config?.configured && !sessionBusy.value && !assistant.state.pending && !!assistant.draft.trim())
let poll: ReturnType<typeof setInterval> | undefined
let refreshing = false
let initialized = false
let seenRevision = ''
let seenSession = ''
let preferredWidth = assistantLayout.defaultWidth
function applyWidth() {
  document.documentElement.style.setProperty('--assistant-width', width.value + 'px')
  document.documentElement.style.setProperty('--assistant-inset', assistant.open && window.innerWidth >= 1000 ? width.value + 'px' : '0px')
}
function onResize() {
  viewportWidth.value = window.innerWidth
  if (viewportWidth.value >= 1000) width.value = Math.round(Math.max(320, Math.min(preferredWidth, maxWidth.value)))
  applyWidth()
}
function rememberWidth(value: number) { preferredWidth = value }
function onScroll() {
  const el = messagesEl.value
  if (el) following.value = el.scrollHeight - el.scrollTop - el.clientHeight < 64
}
async function toLatest() {
  following.value = true
  await nextTick()
  const el = messagesEl.value
  if (el) el.scrollTop = el.scrollHeight
}
async function changeSession(id?: string) {
  const previousId = assistant.state.sessionId
  if (id !== previousId && !await switchAssistantSession(id)) return false
  openTab(assistant.state.sessionId)
  if (assistant.state.sessionId !== previousId) {
    localMessage.value = ''
    seenSession = assistant.state.sessionId
    const latest = assistant.state.turns.at(-1)
    seenRevision = latest ? `${latest.id}-${latest.status}` : ''
    await toLatest()
  }
  return true
}
async function launchNewSession() {
  if (sessionBusy.value) return
  openAssistantChat()
  historyVisible.value = false
  await changeSession()
}
function openTab(id: string) {
  if (!tabs.value.includes(id)) tabs.value.push(id)
}
function tabTitle(id: string) {
  return id === settingsTab ? '设置' : assistant.state.sessions.find(session => session.id === id)?.title ?? '新会话'
}
function openSettings() {
  openTab(settingsTab)
  historyVisible.value = false
  assistant.view = 'settings'
  assistant.open = true
}
async function selectChat(id: string) {
  openAssistantChat()
  if (await changeSession(id)) historyVisible.value = false
}
function canCloseTab(id: string) {
  return id === settingsTab || (chatTabCount.value > 1 && (id !== assistant.state.sessionId || (!sessionBusy.value && !assistant.state.pending)))
}
async function closeTab(id: string) {
  if (!canCloseTab(id)) return
  if (id === settingsTab) assistant.view = 'chat'
  else if (id === assistant.state.sessionId) {
    const index = tabs.value.indexOf(id)
    const neighbors = [...tabs.value.slice(index + 1), ...tabs.value.slice(0, index).reverse()]
    const nextChat = neighbors.find(tab => tab !== settingsTab)
    if (!nextChat || !await changeSession(nextChat)) return
  }
  tabs.value = tabs.value.filter(tab => tab !== id)
}
function canDeleteSession(id: string) {
  return !sessionBusy.value && !assistant.resolving && assistant.state.pending?.sessionId !== id
}
async function removeSession(session: AssistantSession) {
  if (!canDeleteSession(session.id)) return
  try {
    await ElMessageBox.confirm(`删除「${session.title}」及其中的全部消息？`, '删除会话', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonType: 'danger',
    })
  } catch { return }
  if (await deleteAssistantSession(session.id)) ElMessage.success('会话已删除')
  else ElMessage.error(assistant.error || '会话状态已变化，请稍后重试')
}
function moveTabFocus(event: KeyboardEvent, index: number) {
  const buttons = tabList.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  if (!buttons?.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const offset = event.key === 'ArrowLeft' ? -1 : 1
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + offset + buttons.length) % buttons.length
  buttons[next].focus()
}
async function locate(target: AssistantTarget, turn: AssistantTurn) {
  if (hasUnsavedEdits()) { assistant.error = 'AI 修改已就绪，请先保存当前草稿，再点击修改条目定位。'; return }
  await router.push(targetLocation(target, turn))
}
async function refresh() {
  if (refreshing || document.hidden || assistant.switching) return
  refreshing = true
  try {
    await loadAssistant()
    const latest = assistant.state.turns.at(-1)
    const revision = latest ? `${latest.id}-${latest.status}` : ''
    const changedSession = seenSession !== assistant.state.sessionId
    if (!initialized && assistant.state.pending && route.query.aiTurn !== assistant.state.pending.id) await locate(assistant.state.pending.changes[0].target, assistant.state.pending)
    if (initialized && !changedSession && revision !== seenRevision && latest?.changes.length) {
      await locate(latest.changes[0].target, latest)
    }
    seenSession = assistant.state.sessionId
    seenRevision = revision
    initialized = true
  } catch { /* 后台轮询暂时失败，下轮重试 */ }
  finally { refreshing = false }
}
async function submit() {
  if (!canSend.value) return
  await toLatest()
  const focused = [...document.querySelectorAll<HTMLElement>('[data-ai-context]')].find(el => el.getClientRects().length)
  const turn = await sendAssistant({ path: route.fullPath, entity: focused?.dataset.aiEntity ?? route.query.aiEntity, id: focused?.dataset.aiId ?? route.query.aiId })
  if (turn) {
    seenRevision = `${turn.id}-${turn.status}`
    if (turn.changes.length) {
      if (window.innerWidth < 1200) assistant.open = false
      await locate(turn.changes[0].target, turn)
    }
  }
}
async function decide(turn: AssistantTurn, action: 'confirm' | 'undo') {
  const result = await resolveAssistant(turn, action)
  if (result) {
    seenRevision = `${result.id}-${result.status}`
    localMessage.value = action === 'undo' ? '已撤销，原始内容已恢复' : '已确定修改'
    await locate(result.changes[0].target, result)
  }
}
function onShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || (event.target instanceof Element && event.target.closest('[aria-modal="true"]'))) return
  if (event.key === 'Escape' && assistant.open) {
    if (historyVisible.value) historyVisible.value = false
    else assistant.open = false
    return
  }
  if (event.getModifierState('AltGraph')) return
  const key = event.key.toLowerCase()
  const ctrl = event.ctrlKey && !event.metaKey
  const shift = event.shiftKey
  const alt = event.altKey
  const toggle = shift && !alt && ((ctrl && key === 'b') || ((event.ctrlKey || event.metaKey) && key === 'k'))
  const settings = ctrl && !shift && !alt && (key === ',' || key === '，' || event.code === 'Comma')
  const globalNew = ctrl && key === 'n' && ((shift && !alt) || (alt && !shift))
  const sidebarNew = assistant.open && key === 'n' && !shift && !event.metaKey && ((ctrl && !alt) || (alt && !ctrl))
  if (!toggle && !settings && !globalNew && !sidebarNew) return
  event.preventDefault()
  if (event.repeat) return
  if (toggle) assistant.open = !assistant.open
  else if (settings) openSettings()
  else void launchNewSession()
}
watch(() => assistant.open, open => {
  if (open) { preferredWidth = assistantLayout.defaultWidth; onResize(); void refresh(); if (following.value) void toLatest() }
  else { historyVisible.value = false; applyWidth() }
})
watch(width, applyWidth)
watch(() => assistantLayout.defaultWidth, value => { preferredWidth = value; onResize() })
// 分别监听标量；轮询仅替换对象时不触发滚动。阅读历史期间新消息也不抢位置。
watch([() => assistant.state.turns.at(-1)?.id, () => assistant.state.turns.at(-1)?.status, () => assistant.sending], () => { if (following.value) void toLatest() })
watch(() => assistant.state.sessionId, () => { localMessage.value = ''; void toLatest() })
watch(() => assistant.state, state => {
  if (!state.sessions.length) return
  const available = new Set(state.sessions.map(session => session.id))
  const remaining = tabs.value.filter(id => id === settingsTab || available.has(id))
  if (remaining.length !== tabs.value.length) tabs.value = remaining
  openTab(state.sessionId)
}, { immediate: true })
watch(configVisible, visible => { if (!visible && following.value) void toLatest() })
watch([activeTab, () => assistant.open], async () => {
  if (!assistant.open) return
  await nextTick()
  tabList.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
onMounted(() => {
  onResize(); void refresh(); poll = setInterval(() => { void refresh() }, 4000)
  window.addEventListener('keydown', onShortcut); window.addEventListener('resize', onResize)
  if (route.query.assistant === 'open') openAssistantChat()
})
onBeforeUnmount(() => { if (poll) clearInterval(poll); window.removeEventListener('keydown', onShortcut); window.removeEventListener('resize', onResize) })
</script>

<template>
  <button class="assistant-launch" aria-label="新建 AI 对话" aria-keyshortcuts="Control+Shift+N Control+Alt+N" :title="name + ' · 新建对话（Ctrl+Shift+N / Ctrl+Alt+N）'" :disabled="sessionBusy" @click="launchNewSession">
    <el-icon :size="21"><ChatDotRound /></el-icon><span>新建对话</span><i v-if="assistant.state.pending" class="assistant-pending-dot" />
  </button>
  <Teleport to="body">
  <el-button text class="assistant-toggle" :class="{ 'is-active': assistant.open }"
    :aria-label="assistant.open ? '收起 AI 侧栏' : '展开 AI 侧栏'" :title="(assistant.open ? '收起 AI 侧栏' : '展开 AI 侧栏') + '（Ctrl+Shift+B / Ctrl+Shift+K）'"
    aria-keyshortcuts="Control+Shift+B Control+Shift+K"
    :aria-expanded="assistant.open" aria-controls="assistant-panel" @click="assistant.open = !assistant.open">
    <el-icon :size="20"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.7" /><path d="M15 4v16" stroke="currentColor" stroke-width="1.7" /><path v-if="assistant.open" d="M17 8h2v8h-2z" fill="currentColor" /></svg></el-icon>
  </el-button>
  <PanelDivider v-if="assistant.open" v-model="width" class="assistant-divider" side="right" label="调整 AI 侧栏宽度"
    :min="320" :max="maxWidth" :default-width="assistantLayout.defaultWidth" @change="rememberWidth" />
  <aside v-show="assistant.open" id="assistant-panel" class="assistant-panel" aria-label="AI 助手侧栏">
    <header class="assistant-head">
      <strong>{{ name }}</strong><small>DeepSeek V4.1 Flash</small>
    </header>
    <div class="assistant-workspace">
      <div ref="tabList" class="assistant-tabs" role="tablist" aria-label="AI 标签页">
        <div v-for="(id, index) in tabs" :key="id" class="assistant-tab" :class="{ selected: activeTab === id }" role="presentation">
          <button type="button" class="tab-title" role="tab" :aria-selected="activeTab === id" :tabindex="activeTab === id ? 0 : -1"
            :aria-controls="id === settingsTab ? 'assistant-settings-tab' : 'assistant-chat-tab'" :title="tabTitle(id)"
            @click="id === settingsTab ? openSettings() : selectChat(id)" @keydown="moveTabFocus($event, index)" @keydown.delete.prevent="closeTab(id)">
            <el-icon><component :is="id === settingsTab ? Setting : ChatDotRound" /></el-icon><span>{{ tabTitle(id) }}</span>
          </button>
          <button v-if="canCloseTab(id)" type="button" class="tab-close" :aria-label="`关闭标签 ${tabTitle(id)}`" title="关闭标签" @click="closeTab(id)"><el-icon><Close /></el-icon></button>
        </div>
      </div>
      <div class="assistant-tools">
        <el-button text :icon="Setting" aria-label="AI 助手设置" aria-keyshortcuts="Control+," title="AI 助手设置（Ctrl+,）" :class="{ 'is-active': configVisible }" @click="openSettings" />
        <el-popover v-model:visible="historyVisible" trigger="click" placement="bottom-end" :width="258" :teleported="false">
          <template #reference>
            <el-button text :icon="Clock" aria-label="会话记录" title="会话记录" :aria-expanded="historyVisible" />
          </template>
          <div class="assistant-history" @keydown.esc.stop="historyVisible = false">
            <strong>会话记录</strong>
            <p v-if="!assistant.state.sessions.length">正在读取会话…</p>
            <div v-for="session in assistant.state.sessions" :key="session.id" class="history-row" :class="{ current: session.id === assistant.state.sessionId }">
              <button type="button" class="history-select" :disabled="session.id !== assistant.state.sessionId && sessionBusy" @click="selectChat(session.id)">
                <span>{{ session.title }}</span><el-icon v-if="session.id === assistant.state.sessionId"><Check /></el-icon>
                <time :datetime="session.createdAt">{{ new Date(session.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</time>
              </button>
              <button type="button" class="history-delete" :aria-label="`删除会话 ${session.title}`"
                :title="assistant.state.pending?.sessionId === session.id ? '请先处理待确认修改' : '删除会话'"
                :disabled="!canDeleteSession(session.id)" @click="removeSession(session)"><el-icon><Delete /></el-icon></button>
            </div>
          </div>
        </el-popover>
        <el-button text :icon="Plus" aria-label="新建会话" aria-keyshortcuts="Control+N Alt+N" title="新建会话（Ctrl+N / Alt+N）" :disabled="sessionBusy" @click="launchNewSession" />
      </div>
    </div>
    <el-alert v-if="configVisible && assistant.error" :title="assistant.error" type="error" show-icon @close="assistant.error = ''" />
    <AssistantSettings v-if="tabs.includes(settingsTab)" v-show="configVisible" id="assistant-settings-tab" role="tabpanel" />
    <section v-show="!configVisible" id="assistant-chat-tab" class="assistant-chat" role="tabpanel" :aria-label="tabTitle(assistant.state.sessionId)">
    <div ref="messagesEl" class="assistant-messages" aria-live="polite" @scroll="onScroll">
      <div v-if="!assistant.config?.configured" class="assistant-connect"><p>填写自己的 DeepSeek API Key 后即可开始。</p><el-button size="small" @click="openSettings">连接 DeepSeek</el-button></div>
      <div v-if="!assistant.state.turns.length" class="assistant-welcome">
        <span class="assistant-spark">✦</span><h3>聊一聊，也能帮你办事</h3>
        <p>改课表、记倒计日、整理笔记，直接告诉我。</p>
        <button v-for="example in ['新增一个下周五交实验报告的倒计日', '把笔记整理成复习提纲', '今天跑了 2.5 公里，帮我打卡']" :key="example" @click="assistant.draft = example">{{ example }} <span>↗</span></button>
      </div>
      <article v-for="turn in assistant.state.turns" :key="turn.id" class="assistant-turn">
        <div class="user-message">{{ turn.prompt }}</div>
        <div class="ai-message"><span class="speaker">{{ name }}</span><p>{{ turn.answer }}</p></div>
        <div v-if="turn.changes.length" class="assistant-changes">
          <button v-for="change in turn.changes" :key="`${change.entity}:${change.id}`" @click="locate(change.target, turn)"><span>{{ change.action === 'create' ? '新增' : change.action === 'delete' ? '删除' : '修改' }}</span><b>{{ change.label }}</b><el-icon><Position /></el-icon></button>
          <details><summary>查看修改前后</summary><div v-for="change in turn.changes" :key="change.id + change.entity" class="change-diff"><strong>{{ change.label }}</strong><pre>修改前：{{ JSON.stringify(change.before, null, 2) }}</pre><pre>修改后：{{ JSON.stringify(change.after, null, 2) }}</pre></div></details>
          <div v-if="turn.status === 'pending'" class="assistant-decision"><el-button :icon="RefreshLeft" :loading="assistant.resolving" @click="decide(turn, 'undo')">撤销</el-button><el-button type="primary" :icon="Check" :loading="assistant.resolving" @click="decide(turn, 'confirm')">确定修改</el-button></div>
          <small v-else class="resolved-state">{{ turn.status === 'undone' ? '已撤销 · 原内容已恢复' : '已确定修改' }}</small>
        </div>
      </article>
      <div v-if="assistant.sending || assistant.state.busy" class="thinking"><span />正在读取相关记录并处理…</div>
      <p v-if="localMessage" class="assistant-feedback" role="status">{{ localMessage }}</p>
    </div>
    <div v-if="!following" class="latest-action"><el-button size="small" round @click="toLatest">↓ 回到最新</el-button></div>
    <footer class="assistant-compose">
      <el-alert v-if="assistant.error" :title="assistant.error" type="error" show-icon :closable="false" />
      <p v-if="assistant.state.pending" class="pending-hint">请先撤销或确定上方修改，再继续发送。</p>
      <el-input v-model="assistant.draft" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="12000" aria-label="发给 AI 的消息" placeholder="一句话告诉我想做什么…" @keydown.ctrl.enter.prevent="submit" @keydown.meta.enter.prevent="submit" />
      <div class="compose-actions"><small>Ctrl + Enter 发送</small><el-button type="primary" :icon="Position" :disabled="!canSend" :loading="assistant.sending" @click="submit">发送</el-button></div>
    </footer>
    </section>
  </aside>
  </Teleport>
</template>

<style scoped>
.assistant-launch { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 12px; padding: 11px 8px; color: var(--el-color-primary); border: 1px solid var(--el-border-color); border-radius: var(--el-border-radius-base); background: var(--el-fill-color-light); cursor: pointer; font: inherit; position: relative; }
.assistant-launch:disabled { opacity: .55; cursor: wait; }
.assistant-pending-dot { width: 7px; height: 7px; background: var(--el-color-warning); border-radius: 50%; }
.assistant-panel { position: fixed; inset: 0 0 0 auto; width: var(--assistant-width, 420px); z-index: 1800; background: var(--el-bg-color); color: var(--el-text-color-primary); display: flex; flex-direction: column; overflow: hidden; }
.assistant-divider { position: fixed; top: 0; bottom: 0; right: calc(var(--assistant-width, 420px) - 5px); z-index: 1801; }
.assistant-toggle { position: fixed; top: 6px; right: 16px; z-index: 1802; width: 32px; height: 32px; padding: 0; }
.assistant-toggle.is-active, .assistant-tools .is-active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.assistant-workspace { display: flex; align-items: stretch; gap: 4px; padding-inline: 8px; border-bottom: 1px solid var(--el-border-color-light); background: var(--el-fill-color-extra-light); }
.assistant-tabs { display: flex; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
.assistant-tab { display: flex; align-items: stretch; flex-shrink: 0; max-width: 156px; border-inline-end: 1px solid var(--el-border-color-lighter); box-shadow: inset 0 2px transparent; }
.assistant-tab.selected { background: var(--el-bg-color); box-shadow: inset 0 2px var(--el-color-primary); }
.tab-title, .tab-close { display: flex; align-items: center; border: 0; background: transparent; color: var(--el-text-color-secondary); cursor: pointer; font: inherit; }
.tab-title { min-width: 0; gap: 6px; padding: 8px; font-size: 12px; }
.tab-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selected .tab-title { color: var(--el-text-color-primary); }
.tab-close { align-self: center; justify-content: center; margin-right: 4px; padding: 3px; border-radius: 4px; font-size: 12px; }
.tab-title:hover, .tab-close:hover { background: var(--el-fill-color-light); color: var(--el-text-color-primary); }
.tab-title:focus-visible, .tab-close:focus-visible, .assistant-history button:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.assistant-tools { display: flex; flex: none; align-items: center; gap: 2px; }
.assistant-tools .el-button { width: 30px; height: 30px; padding: 0; margin: 0; }
.assistant-history { display: flex; flex-direction: column; gap: 4px; max-height: min(340px, 55dvh); overflow: auto; }
.assistant-history > strong { padding: 4px 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.assistant-history > p { margin: 0; padding: 8px; font-size: 12px; }
.history-row { display: flex; align-items: center; padding-right: 4px; border-radius: 4px; }
.history-row.current, .history-row:hover { background: var(--el-fill-color-light); }
.history-select, .history-delete { border: 0; border-radius: 4px; background: transparent; cursor: pointer; font: inherit; }
.history-select { display: grid; flex: 1; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 8px; padding: 7px 8px; text-align: left; color: var(--el-text-color-primary); }
.history-select .el-icon { color: var(--el-color-primary); }
.history-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-delete { display: grid; place-items: center; width: 28px; height: 28px; flex-shrink: 0; color: var(--el-text-color-secondary); }
.history-delete:hover:not(:disabled) { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.assistant-history button:disabled { opacity: .55; cursor: not-allowed; }
.assistant-history time { grid-column: 1 / -1; font-size: 11px; color: var(--el-text-color-secondary); }
.assistant-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.assistant-connect { font-size: 12px; line-height: 1.7; background: var(--el-fill-color-light); padding: 12px; border-radius: 8px; margin-bottom: 20px; }.assistant-connect p { margin-top: 0; }
.latest-action { height: 0; position: relative; text-align: center; bottom: 36px; z-index: 1; }
.assistant-head { flex-shrink: 0; padding: 11px 60px 11px 16px; border-bottom: 1px solid var(--el-border-color-lighter); }
.assistant-head strong { display: block; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-head small { display: block; font-size: 11px; color: var(--el-text-color-secondary); margin-top: 3px; }
.assistant-messages { flex: 1; min-height: 80px; overflow-y: auto; padding: 18px 16px; overscroll-behavior: contain; scrollbar-width: thin; }.assistant-welcome { padding: 20px 0; }.assistant-spark { font-size: 36px; color: var(--el-color-primary); }.assistant-welcome h3 { font-size: 19px; margin: 14px 0 8px; }.assistant-welcome p { font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.7; }.assistant-welcome button { display: flex; justify-content: space-between; width: 100%; text-align: left; padding: 12px; margin-top: 8px; background: var(--el-fill-color-light); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; color: var(--el-text-color-regular); cursor: pointer; font: inherit; font-size: 12px; gap: 8px; }
.assistant-turn { margin-bottom: 26px; }.user-message { margin-left: 24px; padding: 11px 13px; background: var(--el-color-primary-light-9); border-radius: 12px 12px 2px 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.7; }.ai-message { margin-top: 16px; }.speaker { color: var(--el-color-primary); font-size: 11px; font-weight: 600; }.ai-message p { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.8; margin: 6px 0 12px; }
.assistant-changes { border: 1px solid var(--el-border-color); border-radius: 9px; padding: 10px; }.assistant-changes > button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 4px; background: transparent; border: none; border-bottom: 1px solid var(--el-border-color-lighter); color: inherit; cursor: pointer; text-align: left; }.assistant-changes > button span { font-size: 10px; padding: 3px 5px; border-radius: 4px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); }.assistant-changes > button b { font-size: 12px; font-weight: 500; flex: 1; overflow-wrap: anywhere; }.assistant-changes details { font-size: 12px; margin: 10px 0; }.assistant-changes summary { cursor: pointer; color: var(--el-text-color-secondary); }.change-diff { margin: 12px 0; }.change-diff pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; background: var(--el-fill-color-light); padding: 8px; font-size: 11px; }.assistant-decision { display: flex; justify-content: flex-end; margin-top: 12px; }.resolved-state { display: block; margin-top: 12px; color: var(--el-text-color-secondary); }
.assistant-compose { padding: 12px 16px 16px; border-top: 1px solid var(--el-border-color-lighter); }.compose-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }.compose-actions small,.pending-hint { font-size: 11px; color: var(--el-text-color-secondary); }.thinking,.assistant-feedback { font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }.thinking span { display: inline-block; width: 7px; height: 7px; background: var(--el-color-primary); border-radius: 50%; margin-right: 5px; }.assistant-feedback { color: var(--el-color-success); }
@media(max-width:1080px) { .assistant-launch { margin: 8px; }.assistant-launch > span { display: none; } }
@media(max-width:999px) { .assistant-panel { width: 100vw; }.assistant-divider { display: none; } }
</style>
