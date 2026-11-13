<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { assistant, loadAssistant, saveAssistantKey } from '../stores/assistant'
import { get, put } from '../api/http'
import { PET_SETTINGS_SAVED, type PetConfig } from '../pet/config'
import AssistantWidthSetting from './AssistantWidthSetting.vue'

type PetPreference = PetConfig['main']['pets'][number]
const petFields = ['name', 'size', 'display', 'whisperEnabled', 'fixedEnabled', 'workStatusEnabled'] as const
const router = useRouter()
const keyValue = ref('')
const pets = ref<PetPreference[]>([])
let savedPets: PetPreference[] = []
const saving = ref('')
const petError = ref('')
const loadingPets = ref(true)
function applyPets(config: PetConfig) {
  const previous = new Map(pets.value.map(pet => [pet.id, pet]))
  const baseline = new Map(savedPets.map(pet => [pet.id, pet]))
  savedPets = config.main.pets
  pets.value = savedPets.map(pet => {
    const draft = previous.get(pet.id)
    const saved = baseline.get(pet.id)
    const edits = draft && saved ? petFields.filter(key => draft[key] !== saved[key]).map(key => [key, draft[key]]) : []
    return { ...pet, ...Object.fromEntries(edits) }
  })
}
async function loadPets() {
  loadingPets.value = true
  petError.value = ''
  try { applyPets(await get<PetConfig>('/dsh-pet-7340/config')) }
  catch (error) { petError.value = (error as Error).message }
  finally { loadingPets.value = false }
}
function syncPetSettings(event: Event) {
  if (saving.value !== 'pets') applyPets((event as CustomEvent<PetConfig>).detail)
}
async function save(section: 'key' | 'pets') {
  if (saving.value) return
  saving.value = section
  assistant.error = ''
  try {
    if (section === 'key') { await saveAssistantKey(keyValue.value); keyValue.value = '' }
    if (section === 'pets') {
      // 保存前重新读取，避免覆盖其它设置页刚更新的配置或宠物列表。
      const current = await get<PetConfig>('/dsh-pet-7340/config')
      const editable = new Map(pets.value.map(pet => [pet.id, pet]))
      const baseline = new Map(savedPets.map(pet => [pet.id, pet]))
      const updated = current.main.pets.map(pet => {
        const draft = editable.get(pet.id)
        const saved = baseline.get(pet.id)
        if (!draft || !saved) return pet
        const edits = petFields.filter(key => draft[key] !== saved[key]).map(key => [key, key === 'name' ? draft.name.trim() : draft[key]])
        return { ...pet, ...Object.fromEntries(edits) }
      })
      const config = await put<PetConfig>('/dsh-pet-7340/config', { pets: updated })
      savedPets = []
      applyPets(config)
      document.dispatchEvent(new CustomEvent<PetConfig>(PET_SETTINGS_SAVED, { detail: config }))
      void loadAssistant().catch(() => {})
    }
    ElMessage.success(section === 'key' && !assistant.config?.configured ? 'API Key 已移除' : '设置已保存')
  } catch (error) { assistant.error = (error as Error).message }
  finally { saving.value = '' }
}
onMounted(() => { void loadPets(); document.addEventListener(PET_SETTINGS_SAVED, syncPetSettings) })
onUnmounted(() => document.removeEventListener(PET_SETTINGS_SAVED, syncPetSettings))
</script>

<template>
  <section class="assistant-settings" aria-label="AI 助手设置">
    <h3>助手设置</h3>
    <div class="settings-group"><AssistantWidthSetting /></div>
    <div class="settings-group">
      <h4>DeepSeek API</h4>
      <el-input v-model="keyValue" type="password" show-password autocomplete="off" aria-label="DeepSeek API Key" :placeholder="assistant.config?.keyMask || '填写 sk-…'" @keydown.enter="save('key')" />
      <div class="setting-actions"><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">获取 API Key</a><el-button :loading="saving === 'key'" :disabled="!!saving || (!keyValue.trim() && !assistant.config?.configured)" @click="save('key')">{{ keyValue.trim() || !assistant.config?.configured ? '保存 Key' : '移除 Key' }}</el-button></div>
      <small>Key 在本机加密保存，主密钥由系统凭据库保护；换电脑后需重新填写。对话会将问题和相关记录发送至 DeepSeek。</small>
    </div>
    <div class="settings-group">
      <h4>桌宠</h4>
      <p v-if="loadingPets">正在读取桌宠设置…</p>
      <p v-if="petError" class="setting-error">{{ petError }} <el-button text @click="loadPets">重试</el-button></p>
      <fieldset v-for="pet in pets" :key="pet.id">
        <legend>{{ pet.name }}</legend>
        <label :for="'assistant-pet-name-' + pet.id">桌宠名称</label>
        <el-input :id="'assistant-pet-name-' + pet.id" v-model="pet.name" maxlength="64" aria-label="桌宠名称" />
        <label>显示位置</label>
        <el-select v-model="pet.display" :aria-label="pet.name + '显示位置'">
          <el-option label="网页和桌面" value="both" /><el-option label="仅网页" value="web" /><el-option label="仅桌面" value="desktop" /><el-option label="隐藏" value="none" />
        </el-select>
        <label>大小</label><el-input-number v-model="pet.size" :min="60" :max="600" :step="10" :aria-label="pet.name + '大小'" />
        <div class="setting-toggle"><span>自动碎碎念</span><el-switch v-model="pet.whisperEnabled" :aria-label="pet.name + '自动碎碎念'" /></div>
        <div class="setting-toggle"><span>固定位置</span><el-switch v-model="pet.fixedEnabled" :aria-label="pet.name + '固定位置'" /></div>
        <div class="setting-toggle"><span>跟随 AI 工作状态</span><el-switch v-model="pet.workStatusEnabled" :aria-label="pet.name + '跟随 AI 工作状态'" /></div>
      </fieldset>
      <small>开启自动碎碎念会使用 API 额度。</small>
      <div class="setting-actions"><el-button text @click="router.push('/settings'); assistant.open = false">更多桌宠设置 ↗</el-button><el-button :loading="saving === 'pets'" :disabled="!!saving || loadingPets || !!petError || pets.some(pet => !pet.name.trim())" @click="save('pets')">保存桌宠设置</el-button></div>
    </div>
    <el-alert v-if="assistant.error" :title="assistant.error" type="error" :closable="false" />
  </section>
</template>

<style scoped>
.assistant-settings { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; scrollbar-width: thin; }
h3 { margin: 0 0 20px; font-size: 17px; } h4 { margin: 0 0 12px; font-size: 14px; }
.settings-group { display: flex; flex-direction: column; gap: 10px; padding-bottom: 22px; margin-bottom: 22px; border-bottom: 1px solid var(--el-border-color-lighter); }
label { font-size: 13px; } small { font-size: 11px; line-height: 1.7; color: var(--el-text-color-secondary); }
.setting-actions,.setting-toggle { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; }
.setting-actions a { color: var(--el-color-primary); font-size: 12px; }
fieldset { display: grid; grid-template-columns: 1fr; gap: 10px; min-width: 0; border: 1px solid var(--el-border-color); padding: 14px; border-radius: 8px; }
legend { font-size: 13px; padding: 0 5px; }.setting-error { font-size: 12px; color: var(--el-color-danger); }
</style>
