<template>
  <el-config-provider :locale="epLocale">
    <router-view />
    <UnsavedChangesDialog />
    <PetRuntime />
  </el-config-provider>
</template>

<script setup lang="ts">
import { epLocale } from './locales'
import UnsavedChangesDialog from './components/UnsavedChangesDialog.vue'
import PetRuntime from './components/PetRuntime.vue'
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  font-family: var(--wb-font-ui);
}
/* 页面底色来自 styles/tokens.css 的 --wb-bg（浅色 #f5f7fa / 深色 #0a0a0a，主题预设可覆盖）；
   #app 保持透明，好让 body 上的「底纹」透上来 */
html,
body {
  background-color: var(--wb-bg);
}
/* 页面底 + 主题底纹：
   · --wb-bg-image：主题的"壁纸"（macOS 用柔和渐变；其它主题 none）
   · --wb-texture  ：主题的"纸纹"（paper 用 repeating-linear-gradient 画横格；其它主题 none）
   两者都铺在 body 上、都 fixed 不随滚动，第二层（壁纸）用 cover 撑满。
   主内容滚动区保持透明，内侧页面底板使用半透明主题色，让壁纸和纹理可以透出。 */
body {
  background-color: var(--wb-bg);
  background-image: var(--wb-texture), var(--wb-bg-image);
  background-size: var(--wb-texture-size), cover;
  background-repeat: repeat, no-repeat;
  background-attachment: fixed, fixed;
}
#app {
  background: transparent;
}
</style>
