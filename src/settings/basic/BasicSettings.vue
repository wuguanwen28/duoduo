<template>
  <div class="basic-settings">
    <!-- 顶部工具条 -->
    <SettingsHeader title="基础设置">
      <template #actions>
        <el-button
          v-if="!hideAddCat"
          type="primary"
          :icon="Plus"
          @click="openAdd"
          >新增小猫</el-button
        >
      </template>
    </SettingsHeader>

    <main class="basic-settings__body">
      <!-- 猫卡片列表（两列网格） -->
      <div class="cat-list">
        <div v-for="cat in cats" :key="cat.id" class="cat-card">
          <!-- 上班/下班徽章：点击切换该猫宠物窗的显隐。上班中=绿色渐变。 -->
          <button
            class="cat-card__work"
            :class="{ 'cat-card__work--on': shownIds.has(cat.id) }"
            type="button"
            @click="onToggleWork(cat.id)"
          >
            <el-icon class="cat-card__work-icon">
              <Sunny v-if="shownIds.has(cat.id)" />
              <Moon v-else />
            </el-icon>
            <span>{{ shownIds.has(cat.id) ? "上班中" : "下班了" }}</span>
          </button>
          <div class="cat-card__head">
            <div class="cat-card__avatar-wrap">
              <img class="cat-card__avatar" :src="avatarSrc(cat)" alt="" />
              <span
                v-if="cat.gender !== 'unknown'"
                class="cat-card__gender"
                :class="`cat-card__gender--${cat.gender}`"
                >{{ cat.gender === "boy" ? "♂" : "♀" }}</span
              >
            </div>
            <div class="cat-card__meta">
              <span class="cat-card__name">{{ cat.name || "未命名" }}</span>
              <div class="cat-card__sub">
                <el-tooltip
                  :content="
                    shownIds.has(cat.id)
                      ? '点击切换在线 / 隐身'
                      : '下班中，先上班才能切换'
                  "
                >
                  <span
                    class="cat-card__vis"
                    :class="[
                      visibleIds.has(cat.id)
                        ? 'cat-card__vis--on'
                        : 'cat-card__vis--off',
                      { 'cat-card__vis--clickable': shownIds.has(cat.id) },
                    ]"
                    @click.stop="onToggleVisible(cat.id)"
                    >{{ visibleIds.has(cat.id) ? "在线" : "隐身" }}</span
                  >
                </el-tooltip>
                <span v-if="catAge(cat.birthday)" class="cat-card__age">{{
                  catAge(cat.birthday)
                }}</span>
              </div>
            </div>
          </div>
          <p v-if="cat.description" class="cat-card__desc">
            {{ cat.description }}
          </p>
          <div v-if="cat.tags.length" class="cat-card__tags">
            <el-tag
              v-for="t in cat.tags"
              :key="t"
              size="small"
              :style="tagStyle(t)"
              >{{ t }}</el-tag
            >
          </div>
          <!-- 操作行：启动时打开 + 编辑 + 删除，默认隐藏，hover 时从底部升起。
               显隐切换在「显示与交互」页。 -->
          <div class="cat-card__btns">
            <!-- 启动时自动打开（上班）：勾选的猫在应用启动时自动显示窗口。 -->
            <label class="cat-card__autoshow" @click.stop>
              <el-checkbox
                :model-value="autoShowCats.includes(cat.id)"
                @change="(v) => onToggleAutoShow(cat.id, v as boolean)"
                >启动时打开</el-checkbox
              >
            </label>
            <el-button size="small" :icon="Edit" @click="openEdit(cat.id)"
              >编辑</el-button
            >
            <el-popconfirm
              v-if="!hideAddCat"
              :title="`确定删除「${cat.name || '未命名'}」吗？该猫的所有配置和头像将一并删除，不可恢复。`"
              confirm-button-text="删除"
              cancel-button-text="取消"
              confirm-button-type="danger"
              :width="240"
              @confirm="onDeleteCat(cat.id)"
            >
              <template #reference>
                <el-button
                  size="small"
                  :icon="Delete"
                  type="danger"
                  :disabled="cats.length <= 1"
                  @click.stop
                  >删除</el-button
                >
              </template>
            </el-popconfirm>
          </div>
        </div>
      </div>
    </main>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog
      v-model="dialogOpen"
      :title="editingId ? '编辑小猫' : '新增小猫'"
      width="420px"
      align-center
      :close-on-click-modal="false"
    >
      <el-form label-width="72px" label-position="left">
        <el-form-item label="头像">
          <el-upload
            class="avatar-uploader"
            :auto-upload="false"
            :show-file-list="false"
            accept="image/*"
            @change="onAvatarChange"
          >
            <img :src="previewAvatar" class="avatar-uploader__img" alt="头像" />
          </el-upload>
        </el-form-item>
        <el-form-item label="名字">
          <el-input
            v-model="form.name"
            placeholder="给你的宠物起个名字"
            maxlength="10"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="出生日期">
          <el-date-picker
            v-model="form.birthday"
            type="datetime"
            placeholder="选择出生日期与时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            :editable="false"
            :disabled-date="disableFutureDate"
            class="full-width"
          />
        </el-form-item>
        <el-form-item label="性别">
          <el-select v-model="form.gender">
            <el-option value="boy" label="♂ 弟弟"></el-option>
            <el-option value="girl" label="♀ 妹妹"></el-option>
            <el-option value="unknown" label="保密"></el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            maxlength="60"
            show-word-limit
            resize="none"
            placeholder="一句话介绍这只小猫"
          />
        </el-form-item>
        <el-form-item label="标签">
          <div class="tags-editor">
            <el-tag
              v-for="t in form.tags"
              :key="t"
              closable
              :style="tagStyle(t)"
              @close="removeTag(t)"
              >{{ t }}</el-tag
            >
            <div class="tags-editor__input">
              <el-input
                size="small"
                v-model="newTag"
                placeholder="输入标签后回车"
                @keyup.enter="addTag"
              >
                <template #append>
                  <el-button :icon="Plus" @click="addTag"></el-button>
                </template>
              </el-input>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <!-- 裁剪对话框 -->
    <el-dialog
      v-model="showCropper"
      title="裁剪头像"
      width="400px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="cropper-wrap">
        <Cropper
          v-if="showCropper"
          ref="cropperRef"
          :src="cropperSrc"
          :stencil-props="{ aspectRatio: 1 }"
          :resize-image="{ touch: true, wheel: { ratio: 0.1 } }"
          :auto-zoom="true"
          :default-size="defaultSize"
        />
      </div>
      <template #footer>
        <el-button @click="cancelCrop">取消</el-button>
        <el-button type="primary" @click="confirmCrop">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { Plus, Edit, Delete, Sunny, Moon } from "@element-plus/icons-vue";
import type { UploadFile } from "element-plus";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Cropper } from "vue-advanced-cropper";
import "vue-advanced-cropper/dist/style.css";
import { basicSettings, saveBasicSettings } from "../../pet-core/basicSettings";
import SettingsHeader from "../common/SettingsHeader.vue";
import { hideAddCat } from "../../pet-core/appConfig";
import {
  avatarUrl,
  avatarAssetUrl,
  saveAvatar,
  saveNow,
  currentCatId,
  globalSettings,
  listCats,
  switchCat,
  addCat,
  deleteCat,
  setAutoShowCats,
  type CatEntry,
} from "../../pet-core/appSettings";

/** 默认头像：项目内置 icon.png。 */
const defaultAvatar = new URL("../../assets/icon.png", import.meta.url).href;

// ── 猫卡片列表 ─────────────────────────────────────────────────
/** 卡片视图模型：身份档案已由 listCats 一次拉齐（含性别/标签/描述/生日/头像）。 */
type CatCard = CatEntry;
const cats = ref<CatCard[]>([]);
/** 当前「上班中」（宠物窗存在）的猫 id 集合，用于右上角上班/下班徽章。 */
const shownIds = ref<Set<string>>(new Set());
/** 当前「显示中」（可见未最小化）的猫 id 集合，用于名字下方的显示/隐藏标记。 */
const visibleIds = ref<Set<string>>(new Set());

async function refreshCats() {
  // 身份档案全在全局元数据里，listCats 一次读齐，无需再逐猫打开 cat 文件。
  const cards = await listCats();
  // 后端 cats 存在 HashMap 里、遍历顺序不稳定；这里按创建时间倒序（最新在前）。
  cards.sort((a, b) => catCreatedAt(b.id) - catCreatedAt(a.id));
  cats.value = cards;
}

/**
 * 从猫 id 解析创建时间戳用于排序。
 * 新增猫 id 形如 `c<base36 毫秒>`（见 appSettings.addCat），时间戳越大越新；
 * 初始猫 default 无时间戳，返回 0 视为最早，恒排最后。
 */
function catCreatedAt(id: string): number {
  if (!id.startsWith("c")) return 0;
  const ts = parseInt(id.slice(1), 36);
  return Number.isNaN(ts) ? 0 : ts;
}

/** 刷新「正在显示」状态（轻量，仅查窗口，不重载全部猫）。 */
async function refreshShown() {
  try {
    const [shown, visible] = await Promise.all([
      invoke<string[]>("pet_list_shown_cats"),
      invoke<string[]>("pet_list_visible_cats"),
    ]);
    shownIds.value = new Set(shown);
    visibleIds.value = new Set(visible);
  } catch {
    // 查询失败时保持原状即可，不影响卡片其余展示。
  }
}

/** 「在线/隐身」标签点击：仅对上班中（窗口存在）的猫切换单只显隐；下班的猫忽略。 */
async function onToggleVisible(id: string) {
  if (!shownIds.value.has(id)) return;
  await invoke("pet_toggle_cat_visible", { catId: id }).catch(() => {});
  // 后端会广播 cat-windows-changed，refreshShown 随之更新；此处不必手动刷新。
}

/** 上班/下班徽章点击：切换该猫宠物窗显隐（显示中→关窗下班，隐藏→开窗上班）。 */
async function onToggleWork(id: string) {
  if (shownIds.value.has(id)) {
    await invoke("pet_close_cat_window", { catId: id }).catch(() => {});
  } else {
    await invoke("pet_show_cat_window", { catId: id }).catch(() => {});
  }
  await refreshShown();
}

/** 启动时自动上班的猫 id 列表（卡片勾选）；旧配置空时回退 default 显示。 */
const autoShowCats = computed(() => globalSettings.value?.autoShowCats ?? []);

/** 勾选/取消「启动时打开」：更新 autoShowCats 并写盘。 */
async function onToggleAutoShow(catId: string, checked: boolean) {
  const cur = autoShowCats.value;
  const next = checked ? [...cur, catId] : cur.filter((id) => id !== catId);
  await setAutoShowCats(next);
}

/** 「cat-windows-changed」监听句柄，卸载时注销。 */
let unlistenWins: UnlistenFn | undefined;

onMounted(async () => {
  refreshCats();
  refreshShown();
  // 从宠物窗返回设置页会触发 focus，借此同步「正在显示」状态。
  window.addEventListener("focus", refreshShown);
  // 宠物窗显隐变化（上班 / 下班 / 老板来了）时后端广播，实时刷新卡片状态。
  unlistenWins = await listen("cat-windows-changed", () => refreshShown());
});
onBeforeUnmount(() => {
  window.removeEventListener("focus", refreshShown);
  unlistenWins?.();
});

function avatarSrc(cat: CatEntry): string {
  // 自定义头像经 avatarAssetUrl 统一附加破缓存令牌；无头像回落打包默认图。
  return cat.avatarUrl ? avatarAssetUrl(cat.avatarUrl) : defaultAvatar;
}

/**
 * 由生日（YYYY-MM-DD 或 YYYY-MM-DD HH:mm）计算展示用年龄。
 * 输出「X岁Y天」（不足一岁则「Y天」）：X 为满周岁数，Y 为距最近一次生日的天数。
 * 生日为空/非法/未来时间时返回空串（卡片不展示）。
 */
function catAge(birthday: string): string {
  if (!birthday) return "";
  const born = new Date(birthday.replace(" ", "T"));
  if (Number.isNaN(born.getTime())) return "";
  const now = new Date();
  if (born.getTime() > now.getTime()) return "";
  // 满周岁数：先按年份差估算，若还没到今年生日则减一。
  let years = now.getFullYear() - born.getFullYear();
  const anniversary = new Date(born);
  anniversary.setFullYear(born.getFullYear() + years);
  if (anniversary.getTime() > now.getTime()) {
    years -= 1;
    anniversary.setFullYear(born.getFullYear() + years);
  }
  const dayMs = 86400000;
  const days = Math.floor((now.getTime() - anniversary.getTime()) / dayMs);
  return years > 0 ? `${years}岁${days}天` : `${days}天`;
}

/** 出生日期选择器：禁选未来日期（生日不能晚于今天）。 */
function disableFutureDate(date: Date): boolean {
  return date.getTime() > Date.now();
}

async function onDeleteCat(id: string) {
  await deleteCat(id);
  await refreshCats();
  await refreshShown();
}

// ── 新增 / 编辑弹窗 ───────────────────────────────────────────
const dialogOpen = ref(false);
/** 正在编辑的猫 id；null 表示新增。 */
const editingId = ref<string | null>(null);
const saving = ref(false);

const form = reactive({
  name: "",
  description: "",
  birthday: "",
  gender: "unknown" as "boy" | "girl" | "unknown",
  tags: [] as string[],
});
/** 新裁剪的头像 base64；null 表示未换头像。 */
const pendingAvatar = ref<string | null>(null);
/** 待添加的标签文本。 */
const newTag = ref("");

const previewAvatar = computed(
  () =>
    pendingAvatar.value ||
    (editingId.value ? avatarUrl.value : "") ||
    defaultAvatar,
);

function openAdd() {
  editingId.value = null;
  form.name = "";
  form.description = "";
  form.birthday = "";
  form.gender = "unknown";
  form.tags = [];
  pendingAvatar.value = null;
  newTag.value = "";
  dialogOpen.value = true;
}

async function openEdit(id: string) {
  editingId.value = id;
  await switchCat(id);
  form.name = basicSettings.value.name;
  form.description = basicSettings.value.description;
  form.birthday = basicSettings.value.birthday;
  form.gender = basicSettings.value.gender;
  form.tags = [...basicSettings.value.tags];
  pendingAvatar.value = null;
  newTag.value = "";
  dialogOpen.value = true;
}

function addTag() {
  const t = newTag.value.trim();
  if (t && !form.tags.includes(t)) {
    form.tags.push(t);
  }
  newTag.value = "";
}

function removeTag(t: string) {
  form.tags = form.tags.filter((x) => x !== t);
}

/** 标签配色板：浅底 + 深字 + 描边，风格柔和。 */
const TAG_PALETTE = [
  { bg: "#eaf3ff", fg: "#2f6fed", bd: "#c3ddff" },
  { bg: "#e9f8ef", fg: "#1f9d55", bd: "#bfe8d0" },
  { bg: "#fff3e6", fg: "#e8820c", bd: "#ffdcb3" },
  { bg: "#fdecef", fg: "#e14b6a", bd: "#f9c7d1" },
  { bg: "#f0ecfd", fg: "#7c53e0", bd: "#d8cbf7" },
  { bg: "#e7f6f8", fg: "#1197a6", bd: "#bde7ec" },
  { bg: "#fef6e0", fg: "#c99400", bd: "#f5e2a8" },
  { bg: "#fbeaf6", fg: "#c74bb0", bd: "#f3c7e6" },
];

/**
 * 标签文本 → 稳定配色。
 * 由文本哈希映射到调色板，保证同名标签配色恒定、弹窗与卡片一致，
 * 视觉上呈「随机彩色」，无需持久化颜色字段。
 */
function tagStyle(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  const c = TAG_PALETTE[h % TAG_PALETTE.length];
  // 用 Element Plus 自身的 CSS 变量上色，文字/背景/描边/关闭图标统一生效。
  return {
    "--el-tag-bg-color": c.bg,
    "--el-tag-text-color": c.fg,
    "--el-tag-border-color": c.bd,
  };
}

async function onSave() {
  // 名字必填：为空则提示并阻断保存（不再回落到「多多」）。
  const name = form.name.trim();
  if (!name) {
    ElMessage.warning("请给小猫起个名字");
    return;
  }
  saving.value = true;
  try {
    let id = editingId.value;
    if (!id) {
      id = await addCat();
      editingId.value = id;
    } else if (currentCatId.value !== id) {
      await switchCat(id);
    }
    basicSettings.value = {
      ...basicSettings.value,
      name,
      description: form.description.trim(),
      birthday: form.birthday,
      gender: form.gender,
      tags: [...form.tags],
    };
    saveBasicSettings();
    // 立即落盘并把身份档案写回全局 cats[id]：saveBasicSettings 只是广播 + 防抖写盘（300ms），
    // 若不等它完成，紧接着的 refreshCats 会读到 addCat 写入的空身份 → 卡片显示「未命名」。
    await saveNow();
    if (pendingAvatar.value) {
      await saveAvatar(pendingAvatar.value);
      pendingAvatar.value = null;
    }
    await refreshCats();
    dialogOpen.value = false;
  } finally {
    saving.value = false;
  }
}

// ── 头像裁剪 ───────────────────────────────────────────────────
const showCropper = ref(false);
const cropperSrc = ref("");
const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);

function onAvatarChange(uploadFile: UploadFile) {
  const file = uploadFile.raw;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    cropperSrc.value = reader.result as string;
    showCropper.value = true;
  };
  reader.readAsDataURL(file);
}

function defaultSize({
  imageSize,
}: {
  imageSize: { width: number; height: number };
}) {
  return {
    width: Math.min(imageSize.width, imageSize.height) * 1,
    height: Math.min(imageSize.width, imageSize.height) * 1,
  };
}

function cancelCrop() {
  showCropper.value = false;
  cropperSrc.value = "";
}

function confirmCrop() {
  if (!cropperRef.value) return;
  const { canvas } = cropperRef.value.getResult();
  if (!canvas) return;
  const target = document.createElement("canvas");
  const size = 256;
  target.width = size;
  target.height = size;
  const ctx = target.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, size, size);
  pendingAvatar.value = target.toDataURL("image/png");
  showCropper.value = false;
  cropperSrc.value = "";
}
</script>

<style scoped>
.basic-settings__body {
  padding: 28px 32px;
}

/* 猫卡片：弹性换行、从左排列 */
.cat-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 14px;
}
.cat-card {
  position: relative;
  overflow: hidden;
  /* 允许在最小/最大宽度间伸缩，避免过窄或过宽 */
  flex: 1 1 240px;
  min-width: 180px;
  max-width: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  text-align: center;
  transition:
    box-shadow 0.15s,
    border-color 0.15s,
    transform 0.15s;
}
.cat-card:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-4px);
}
/* 右上角「摸鱼中」角标 */
/* 上班/下班徽章：可点击切换宠物窗显隐。 */
.cat-card__work {
  position: absolute;
  top: 0px;
  right: 0px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1;
  color: #fff;
  border: none;
  border-radius: 0 10px 0 10px;
  cursor: pointer;
  /* 下班了：灰色 */
  background: linear-gradient(135deg, #c7c9cc, #8b8f97);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
  transition:
    transform 0.12s,
    box-shadow 0.12s,
    background 0.2s;
}

.cat-card__work:active {
  transform: translateY(0);
}
/* 上班中：绿色渐变 */
.cat-card__work--on {
  background: linear-gradient(135deg, #8df3ce, #10b981);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.45);
}
.cat-card__work-icon {
  font-size: 15px;
}
/* 头部行：头像 + 右侧名字/年龄，整体在卡片内居中 */
.cat-card__head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  max-width: 100%;
}
.cat-card__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 0;
}
.cat-card__avatar-wrap {
  position: relative;
  flex: none;
  line-height: 0;
}
.cat-card__avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color-light);
}
/* 头像右下角性别徽标 */
.cat-card__gender {
  position: absolute;
  right: -2px;
  bottom: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 3px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  color: #fff;
  border: 2px solid #fff;
  box-sizing: border-box;
}
.cat-card__gender--boy {
  background: #4c9bfd;
}
.cat-card__gender--girl {
  background: #ff7eb0;
}
.cat-card__name {
  max-width: 100%;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 显示/隐藏状态标签 + 年龄同处一行 */
.cat-card__sub {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 年龄：X岁Y天 */
.cat-card__age {
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: 500;
}
/* 显示/隐藏状态小标签 */
.cat-card__vis {
  font-size: 11px;
  line-height: 1.6;
  padding: 0 6px;
  border-radius: 8px;
  cursor: default;
}
.cat-card__vis--on {
  color: #10b981;
  background: #e9f8ef;
}
.cat-card__vis--off {
  color: #8b8f97;
  background: #f0f1f3;
}
/* 上班中才可点切换在线/隐身；下班时不可点。 */
.cat-card__vis--clickable {
  cursor: pointer;
}
.cat-card__vis--clickable:hover {
  filter: brightness(0.95);
}
/* 描述：最多两行，超出省略 */
.cat-card__desc {
  margin: 0;
  max-width: 100%;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 卡片内标签行 */
.cat-card__tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
}
/* 操作行：底部悬浮条，默认隐藏，hover 升起。启动勾选 + 编辑 + 删除三者占满整行 */
.cat-card__btns {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 10px;
  background: #fff;
  transform: translateY(100%);
  opacity: 0;
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
  box-shadow: 0 0 10px 0px rgba(0, 0, 0, 0.03);
}
.cat-card:hover .cat-card__btns {
  transform: translateY(0);
  opacity: 1;
}
/* 悬浮条内按钮间距统一由 gap 控制 */
.cat-card__btns .el-button + .el-button {
  margin-left: 0;
}
/* 启动勾选靠左占位，标签不换行 */
.cat-card__autoshow {
  white-space: nowrap;
}

/* 弹窗：输入框统一宽度 */
.full-width,
.full-width :deep(.el-input__wrapper),
:deep(.el-date-editor.el-input),
:deep(.el-date-editor.el-input__wrapper) {
  width: 100%;
}
.avatar-uploader :deep(.el-upload) {
  display: block;
}
.avatar-uploader__img {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--el-border-color-light);
  display: block;
  cursor: pointer;
}

/* 标签编辑器 */
.tags-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.tags-editor__input {
  width: 160px;
}

.cropper-wrap {
  height: 300px;
}
</style>
