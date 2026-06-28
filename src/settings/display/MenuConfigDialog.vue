<template>
  <el-dialog
    v-model="visible"
    title="🧭 右键菜单设置"
    width="520px"
    align-center
    :close-on-click-modal="false"
  >
    <MenuConfigCard />

    <template #footer>
      <div class="menu-config-dialog__footer">
        <el-button type="primary" @click="visible = false">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import MenuConfigCard from "./MenuConfigCard.vue";

const visible = defineModel<boolean>("visible", { required: true });
</script>

<style scoped>
.menu-config-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
