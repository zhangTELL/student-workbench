<script setup lang="ts">
import { computed } from 'vue'
import { injectReplyMarkdownCss, renderReplyMarkdown } from '../../../vendor/dsh-pet/src/shared/reply-markdown'

const props = defineProps<{ text: string }>()
const html = computed(() => renderReplyMarkdown(props.text))
injectReplyMarkdownCss()
</script>

<template>
  <div class="reply-markdown" v-html="html" />
</template>
