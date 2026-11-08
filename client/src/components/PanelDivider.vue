<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  defaultWidth: number
  side: 'left' | 'right'
  label: string
}>()
const emit = defineEmits<{ 'update:modelValue': [width: number]; change: [width: number] }>()
const resizing = ref(false)
let drag: { pointerId: number; x: number; width: number; userSelect: string; cursor: string } | undefined
let nextWidth = 0

function resize(width: number) {
  nextWidth = Math.round(Math.max(props.min, Math.min(props.max, width)))
  emit('update:modelValue', nextWidth)
}

function begin(event: PointerEvent) {
  if (event.button !== 0 || drag) return
  event.preventDefault()
  drag = { pointerId: event.pointerId, x: event.clientX, width: props.modelValue, userSelect: document.body.style.userSelect, cursor: document.body.style.cursor }
  nextWidth = props.modelValue
  resizing.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function move(event: PointerEvent) {
  if (event.pointerId !== drag?.pointerId) return
  const offset = event.clientX - drag.x
  resize(drag.width + (props.side === 'left' ? offset : -offset))
}

function end(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return
  document.body.style.userSelect = drag.userSelect
  document.body.style.cursor = drag.cursor
  drag = undefined
  resizing.value = false
  emit('change', nextWidth)
}

function onKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
  event.preventDefault()
  const direction = props.side === 'left' ? 1 : -1
  const offset = (event.key === 'ArrowRight' ? 24 : -24) * direction
  resize(event.key === 'Home' ? props.defaultWidth : props.modelValue + offset)
  emit('change', nextWidth)
}

onBeforeUnmount(() => end())
</script>

<template>
  <div class="panel-divider" :class="{ resizing }" role="separator" :aria-label="label" aria-orientation="vertical"
    :aria-valuenow="modelValue" :aria-valuemin="min" :aria-valuemax="max" tabindex="0"
    @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="end" @lostpointercapture="end" @keydown="onKeydown" />
</template>

<style scoped>
.panel-divider { width: 10px; cursor: col-resize; touch-action: none; }
.panel-divider::after { content: ''; position: absolute; inset: 0 auto 0 4px; width: 2px; background: var(--el-text-color-primary); }
.panel-divider:hover::after, .panel-divider.resizing::after, .panel-divider:focus-visible::after { width: 3px; background: var(--el-color-primary); }
</style>
