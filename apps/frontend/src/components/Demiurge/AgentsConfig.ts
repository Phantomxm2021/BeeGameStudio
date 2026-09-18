import {
    Cpu,
    Code,
    Palette,
    BookOpen,
    Eye,
    Zap,
    Briefcase,
    Layout,
    Shield,
    Database,
    Rocket,
} from 'lucide-react';
import type { ComponentProps } from 'react';
import { BeeGameLogo } from '../BeeGameLogo';

export const BeeIcon = (props: ComponentProps<typeof BeeGameLogo>) => (
    BeeGameLogo(props)
);

// --- I18N Metadata ---
export type Language = 'en' | 'zh' | 'zh-TW' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'it' | 'pt';

export const LANGUAGE_OPTIONS: Array<{ code: Language; label: string }> = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '简体中文' },
    { code: 'zh-TW', label: '繁體中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'it', label: 'Italiano' },
    { code: 'pt', label: 'Português' },
];

// --- Layer Definitions (from SystemDesign/04-智能体系统) ---
export type AgentLayer = 'governor' | 'cognitive' | 'implementation' | 'verification';

export const LAYER_CONFIG: Record<AgentLayer, { label: string; labelEn: string; y: number }> = {
    governor:       { label: '运行时治理', labelEn: 'GOVERNOR',       y: 160 },
    cognitive:      { label: '认知设计层', labelEn: 'DESIGN',          y: 380 },
    implementation: { label: '实现执行层', labelEn: 'IMPLEMENTATION',  y: 600 },
    verification:   { label: '验证构建层', labelEn: 'VERIFICATION',   y: 820 },
};

// Card width constant for centering math (w-56 = 224px)
const CARD_W = 224;
// Canvas logical width
const CANVAS_W = 1000;

// Centering helpers
const center1 = (CANVAS_W - CARD_W) / 2;                     // single node center
const row4 = (i: number) => 30 + i * ((CANVAS_W - 60 - CARD_W) / 3);  // 4-node row
const row2 = (i: number) => (CANVAS_W - 2 * CARD_W - 80) / 2 + i * (CARD_W + 80); // 2-node row centered

// --- Dynamic BeeGame capability UI mapping ---
export const AGENT_UI_MAP: Record<string, { name: string; role: string; x: number; y: number; icon: any; color: string; text: string; border: string; bio: string; layer: AgentLayer; phase: string }> = {
    'beegame': {
        name: 'BeeGame', role: '游戏构建代理', x: center1, y: LAYER_CONFIG.governor.y, icon: BeeIcon,
        color: 'bg-[#D77757]', text: 'text-[#D77757]', border: 'border-[#D77757]/50',
        bio: '核心能力：把想法转成文档、代码、工具调用与可运行项目。',
        layer: 'governor', phase: 'Session'
    },
    'logos': {
        name: 'Intake', role: '需求整理', x: center1, y: LAYER_CONFIG.governor.y, icon: Briefcase,
        color: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500/50',
        bio: '整理用户想法，明确项目目标、限制和下一步。',
        layer: 'governor', phase: 'Intake'
    },
    'metis': {
        name: 'Game Design', role: '游戏策划', x: row4(0), y: LAYER_CONFIG.cognitive.y, icon: BookOpen,
        color: 'bg-purple-500', text: 'text-purple-500', border: 'border-purple-500/50',
        bio: '定义玩法、节奏、目标、反馈和可玩性标准。',
        layer: 'cognitive', phase: 'Design'
    },
    'tecton': {
        name: 'Architecture', role: '技术架构', x: row4(1), y: LAYER_CONFIG.cognitive.y, icon: Cpu,
        color: 'bg-indigo-500', text: 'text-indigo-500', border: 'border-indigo-500/50',
        bio: '规划项目结构、技术方案和运行方式。',
        layer: 'cognitive', phase: 'Tech'
    },
    'apollo': {
        name: 'Art Direction', role: '美术指导', x: row4(2), y: LAYER_CONFIG.cognitive.y, icon: Palette,
        color: 'bg-pink-500', text: 'text-pink-500', border: 'border-pink-500/50',
        bio: '定义视觉风格、资源占位和替换方向。',
        layer: 'cognitive', phase: 'Art'
    },
    'morphe': {
        name: 'Experience', role: 'UI/UX 设计', x: row4(3), y: LAYER_CONFIG.cognitive.y, icon: Layout,
        color: 'bg-rose-500', text: 'text-rose-500', border: 'border-rose-500/50',
        bio: '设计界面、反馈和玩家操作路径。',
        layer: 'cognitive', phase: 'UX'
    },
    'hephaestus': {
        name: 'Implementation', role: '工程实现', x: row4(0), y: LAYER_CONFIG.implementation.y, icon: Code,
        color: 'bg-muted', text: 'text-foreground', border: 'border-success-500/50',
        bio: '实现游戏逻辑、系统和运行入口。',
        layer: 'implementation', phase: 'Build'
    },
    'sankta': {
        name: 'Interface', role: '界面实现', x: row4(1), y: LAYER_CONFIG.implementation.y, icon: Zap,
        color: 'bg-muted', text: 'text-foreground', border: 'border-warning-500/50',
        bio: '实现界面、交互反馈和可操作流程。',
        layer: 'implementation', phase: 'Interface'
    },
    'hyle': {
        name: 'Assets', role: '资产管理', x: row4(2), y: LAYER_CONFIG.implementation.y, icon: Database,
        color: 'bg-orange-500', text: 'text-orange-500', border: 'border-orange-500/50',
        bio: '整理资源清单、placeholder 和替换入口。',
        layer: 'implementation', phase: 'Assets'
    },
    'pneuma': {
        name: 'Tech Art', role: '技术美术', x: row4(3), y: LAYER_CONFIG.implementation.y, icon: Rocket,
        color: 'bg-violet-500', text: 'text-violet-500', border: 'border-violet-500/50',
        bio: '连接资源、效果和运行时表现。',
        layer: 'implementation', phase: 'Tech Art'
    },
    'argus': {
        name: 'Review', role: '体验检查', x: row2(0), y: LAYER_CONFIG.verification.y, icon: Shield,
        color: 'bg-muted', text: 'text-foreground', border: 'border-destructive-500/50',
        bio: '检查可运行性、玩家路径和已知缺口。',
        layer: 'verification', phase: 'Review'
    },
    'synthet': {
        name: 'Preview', role: '预览检查', x: row2(1), y: LAYER_CONFIG.verification.y, icon: Eye,
        color: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-500/50',
        bio: '验证启动、预览和交付说明。',
        layer: 'verification', phase: 'Preview'
    }
};

// Workflow connections from SystemDesign/04-智能体系统 & 05-工作流程
export const CONNECTIONS = [
    // Governor → Cognitive
    { from: 'logos', to: 'metis' },
    { from: 'logos', to: 'tecton' },
    { from: 'logos', to: 'apollo' },
    { from: 'logos', to: 'morphe' },
    // Cognitive cross-links
    { from: 'metis', to: 'morphe' },       // GDD informs UI design
    { from: 'apollo', to: 'morphe' },      // Art direction informs visual layer
    // Cognitive → Implementation
    { from: 'tecton', to: 'hephaestus' },  // Architecture → Gameplay code
    { from: 'morphe', to: 'sankta' },      // UI blueprint → UI implementation
    { from: 'tecton', to: 'pneuma' },      // Architecture → Tech Art
    { from: 'hyle', to: 'pneuma' },        // Asset validation collaboration
    // Implementation → Verification
    { from: 'hephaestus', to: 'argus' },   // Code → QA
    { from: 'sankta', to: 'argus' },       // UI → QA
    { from: 'argus', to: 'synthet' },      // QA gate → Build
];

export const ARTIFACT_TYPES = ['Vision', 'GDD', 'ADD', 'UI/UX', 'XDD', 'TDD'];
