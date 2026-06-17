<template>
  <el-config-provider :locale="zhCn">
    <div class="settings-layout">
    <!-- 左侧导航栏 -->
    <aside class="settings-nav">
      <div class="settings-nav__header">
        <div class="settings-nav__avatar-wrap">
          <img
            class="settings-nav__avatar"
            :src="basicSettings.avatar || defaultAvatar"
            alt="头像"
          />
          <span
            v-if="basicSettings.gender !== 'unknown'"
            class="settings-nav__gender"
            :class="`settings-nav__gender--${basicSettings.gender}`"
          >
            {{ basicSettings.gender === "boy" ? "♂" : "♀" }}
          </span>
        </div>
        <span class="settings-nav__name">{{ basicSettings.name }}</span>
      </div>
      <nav class="settings-nav__menu">
        <div
          v-for="item in navItems"
          :key="item.key"
          class="settings-nav__item"
          :class="{ 'settings-nav__item--active': activeKey === item.key }"
          @click="activeKey = item.key"
        >
          <span class="settings-nav__icon">{{ item.icon }}</span>
          <span class="settings-nav__label">{{ item.label }}</span>
        </div>
      </nav>
    </aside>

    <!-- 右侧内容区 -->
    <main class="settings-main">
      <KeepAlive>
        <BasicSettings v-if="activeKey === 'basic'" />
        <ResourceSettings v-else-if="activeKey === 'resources'" />
        <ShortcutSettings v-else-if="activeKey === 'shortcuts'" />
      </KeepAlive>
    </main>
  </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
// @ts-ignore
import zhCn from "element-plus/dist/locale/zh-cn.mjs";
import BasicSettings from "./BasicSettings.vue";
import ResourceSettings from "./resource/ResourceSettings.vue";
import ShortcutSettings from "./ShortcutSettings.vue";
import { basicSettings } from "../composables/useBasicSettings";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 默认头像：项目内置 icon.png。 */
const defaultAvatar = new URL("../assets/icon.png", import.meta.url).href;

interface NavItem {
  key: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { key: "basic", label: "基础设置", icon: "🐱" },
  { key: "resources", label: "资源设置", icon: "📂" },
  { key: "shortcuts", label: "快捷键设置", icon: "⌨️" },
];

const activeKey = ref("basic");

/** 监听导航事件：窗口已打开时，主窗发送的导航指令。 */
let unlistenNav: UnlistenFn | undefined;
onMounted(async () => {
  // 获取并消费打开时指定的初始标签页（如有）。
  const initialTab = await invoke<string | null>("pet_consume_pending_tab");
  if (initialTab) {
    activeKey.value = initialTab;
  }
  // 监听后续的导航事件（窗口已打开时）。
  unlistenNav = await listen<string>("navigate-to", (event) => {
    activeKey.value = event.payload;
  });
});
onUnmounted(() => {
  unlistenNav?.();
});
</script>

<style scoped>
.settings-layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

/* 左侧导航栏 */
.settings-nav {
  flex: none;
  width: 180px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--el-border-color-light);
}

.settings-nav__header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 54px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--el-border-color-light);
}
.settings-nav__avatar-wrap {
  position: relative;
  flex: none;
}
.settings-nav__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color-light);
  display: block;
}
.settings-nav__gender {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: #fff;
  border: 1px solid #fff;
}
.settings-nav__gender--boy {
  background: #4a9eff;
}
.settings-nav__gender--girl {
  background: #ff6b9d;
}
.settings-nav__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-nav__menu {
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 4px;
}

.settings-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  color: var(--el-text-color-regular);
  font-size: 14px;
}
.settings-nav__item:hover {
  background: var(--el-fill-color-light);
}
.settings-nav__item--active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.settings-nav__icon {
  font-size: 16px;
  line-height: 1;
  flex: none;
}
.settings-nav__label {
  line-height: 1;
}

/* 右侧内容区 */
.settings-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: #f5f6f8;
}
</style>
