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
import { createElement } from 'react';
import type { SVGProps } from 'react';

export const BeeIcon = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
    createElement(
        'svg',
        { viewBox: '0 0 24 24', className, 'aria-hidden': true, ...props },
        createElement('path', { d: 'M8.5 7.8c-.9-.9-2.2-1.7-3.9-2.4-.2 1.8.1 3.2 1 4.2.7.8 1.7 1.2 3 1.3', fill: 'currentColor', opacity: '0.35' }),
        createElement('path', { d: 'M15.5 7.8c.9-.9 2.2-1.7 3.9-2.4.2 1.8-.1 3.2-1 4.2-.7.8-1.7 1.2-3 1.3', fill: 'currentColor', opacity: '0.35' }),
        createElement('path', { d: 'M7 13.2c0-3 2.1-5.2 5-5.2s5 2.2 5 5.2c0 3.2-2.2 5.8-5 5.8s-5-2.6-5-5.8Z', fill: 'currentColor' }),
        createElement('path', { d: 'M8.2 12h7.6M8.4 15h7.2', stroke: 'black', strokeWidth: '1.4', strokeLinecap: 'round', opacity: '0.45' }),
        createElement('path', { d: 'M10 7.7 8.7 5.5M14 7.7l1.3-2.2', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' }),
        createElement('circle', { cx: '10', cy: '11', r: '.75', fill: 'black', opacity: '0.6' }),
        createElement('circle', { cx: '14', cy: '11', r: '.75', fill: 'black', opacity: '0.6' }),
    )
);

// --- I18N Data ---
export const translations = {
    zh: {
        placeholder: "输入项目愿景开始...",
        newProject: "新建项目",
        stop: "停止项目",
        resume: "恢复项目",
        active: "运行中",
        idle: "空闲",
        stopped: "已停止",
        chat: "团队协作",
        runtime: "运行时",
        artifacts: "交付产物",
        tokens: "消耗",
        progress: "进度",
        phase: "阶段",
        paused: "已暂停",
        settings: "系统设置",
        theme: "主题切换",
        darkMode: "深色模式",
        language: "语言选择",
        systemSettings: "系统设置",
        offline: "无法访问服务器",
        tasks: "任务看板",
        projectLibrary: "项目库",
        historyProjects: "历史项目",
        recentProjects: "最近项目",
        open: "打开",
        landingTitle: "从一个想法开始",
        landingSubtitle: "寥寥几句，就足以启程。",
        ideaPlaceholder: "描述你想构建的游戏、工具或交互体验",
        generate: "生成"
    },
    'zh-TW': {
        placeholder: "輸入專案願景開始...",
        newProject: "新增專案",
        stop: "停止專案",
        resume: "恢復專案",
        active: "執行中",
        idle: "閒置",
        stopped: "已停止",
        chat: "團隊協作",
        runtime: "執行階段",
        artifacts: "交付成果",
        tokens: "消耗",
        progress: "進度",
        phase: "階段",
        paused: "已暫停",
        settings: "系統設定",
        theme: "主題切換",
        darkMode: "深色模式",
        language: "語言選擇",
        systemSettings: "系統設定",
        offline: "無法連線伺服器",
        tasks: "任務看板",
        projectLibrary: "專案庫",
        historyProjects: "歷史專案",
        recentProjects: "最近專案",
        open: "開啟",
        landingTitle: "從一個想法開始",
        landingSubtitle: "短短幾句，就足以開始。",
        ideaPlaceholder: "描述你想建構的遊戲、工具或互動體驗",
        generate: "生成"
    },
    en: {
        placeholder: "Enter project vision...",
        newProject: "New Project",
        stop: "Stop",
        resume: "Resume",
        active: "Running",
        idle: "Idle",
        stopped: "Stopped",
        chat: "Collab",
        runtime: "Runtime",
        artifacts: "Artifacts",
        tokens: "Tokens",
        progress: "Progress",
        phase: "Phase",
        paused: "Paused",
        settings: "Settings",
        theme: "Theme",
        darkMode: "Dark Mode",
        language: "Language",
        systemSettings: "System Settings",
        offline: "Server Unreachable",
        tasks: "Tasks",
        projectLibrary: "Project Library",
        historyProjects: "History Projects",
        recentProjects: "Recent Projects",
        open: "Open",
        landingTitle: "Start with an idea.",
        landingSubtitle: "A few words are enough to begin.",
        ideaPlaceholder: "Describe the game, tool, or interactive experience you want to build",
        generate: "Generate"
    },
    ja: {
        placeholder: "ビジョンを入力...",
        newProject: "新規作成",
        stop: "停止",
        resume: "再開",
        active: "実行中",
        idle: "待機",
        stopped: "停止中",
        chat: "チャット",
        runtime: "ランタイム",
        artifacts: "成果物",
        tokens: "トークン",
        progress: "進捗",
        phase: "フェーズ",
        paused: "一時停止中",
        settings: "設定",
        theme: "テーマ",
        darkMode: "ダークモード",
        language: "言語",
        systemSettings: "システム設定",
        offline: "サーバーアクセス不可",
        tasks: "タスク",
        projectLibrary: "プロジェクトライブラリ",
        historyProjects: "履歴プロジェクト",
        recentProjects: "最近のプロジェクト",
        open: "開く",
        landingTitle: "ひとつのアイデアから始めよう。",
        landingSubtitle: "はじめるのに、多くの言葉はいりません。",
        ideaPlaceholder: "作成したいゲーム、ツール、インタラクティブ体験を説明してください",
        generate: "生成"
    },
    ko: {
        placeholder: "프로젝트 비전을 입력하세요...",
        newProject: "새 프로젝트",
        stop: "프로젝트 중지",
        resume: "프로젝트 재개",
        active: "실행 중",
        idle: "대기 중",
        stopped: "중지됨",
        chat: "팀 협업",
        runtime: "런타임",
        artifacts: "결과물",
        tokens: "사용량",
        progress: "진행률",
        phase: "단계",
        paused: "일시 중지됨",
        settings: "설정",
        theme: "테마 전환",
        darkMode: "다크 모드",
        language: "언어 선택",
        systemSettings: "시스템 설정",
        offline: "서버에 연결할 수 없음",
        tasks: "작업 보드",
        projectLibrary: "프로젝트 라이브러리",
        historyProjects: "이전 프로젝트",
        recentProjects: "최근 프로젝트",
        open: "열기",
        landingTitle: "하나의 아이디어에서 시작하세요.",
        landingSubtitle: "몇 마디면 시작하기에 충분합니다.",
        ideaPlaceholder: "만들고 싶은 게임, 도구 또는 인터랙티브 경험을 설명하세요",
        generate: "생성"
    },
    fr: {
        placeholder: "Saisissez la vision du projet...",
        newProject: "Nouveau projet",
        stop: "Arrêter le projet",
        resume: "Reprendre le projet",
        active: "En cours",
        idle: "Inactif",
        stopped: "Arrêté",
        chat: "Collaboration",
        runtime: "Exécution",
        artifacts: "Livrables",
        tokens: "Consommation",
        progress: "Progression",
        phase: "Phase",
        paused: "En pause",
        settings: "Paramètres",
        theme: "Changer de thème",
        darkMode: "Mode sombre",
        language: "Langue",
        systemSettings: "Paramètres système",
        offline: "Serveur inaccessible",
        tasks: "Tableau des tâches",
        projectLibrary: "Bibliothèque de projets",
        historyProjects: "Projets récents",
        recentProjects: "Projets récents",
        open: "Ouvrir",
        landingTitle: "Commencez par une idée.",
        landingSubtitle: "Quelques mots suffisent pour commencer.",
        ideaPlaceholder: "Décrivez le jeu, l’outil ou l’expérience interactive que vous voulez créer",
        generate: "Générer"
    },
    de: {
        placeholder: "Projektvision eingeben...",
        newProject: "Neues Projekt",
        stop: "Projekt stoppen",
        resume: "Projekt fortsetzen",
        active: "Läuft",
        idle: "Leerlauf",
        stopped: "Gestoppt",
        chat: "Zusammenarbeit",
        runtime: "Laufzeit",
        artifacts: "Ergebnisse",
        tokens: "Verbrauch",
        progress: "Fortschritt",
        phase: "Phase",
        paused: "Pausiert",
        settings: "Einstellungen",
        theme: "Design wechseln",
        darkMode: "Dunkelmodus",
        language: "Sprache",
        systemSettings: "Systemeinstellungen",
        offline: "Server nicht erreichbar",
        tasks: "Aufgabenboard",
        projectLibrary: "Projektbibliothek",
        historyProjects: "Projektverlauf",
        recentProjects: "Letzte Projekte",
        open: "Öffnen",
        landingTitle: "Beginne mit einer Idee.",
        landingSubtitle: "Ein paar Worte genügen, um anzufangen.",
        ideaPlaceholder: "Beschreibe das Spiel, Tool oder interaktive Erlebnis, das du erstellen möchtest",
        generate: "Generieren"
    },
    es: {
        placeholder: "Introduce la visión del proyecto...",
        newProject: "Nuevo proyecto",
        stop: "Detener proyecto",
        resume: "Reanudar proyecto",
        active: "En ejecución",
        idle: "Inactivo",
        stopped: "Detenido",
        chat: "Colaboración",
        runtime: "Ejecución",
        artifacts: "Entregables",
        tokens: "Consumo",
        progress: "Progreso",
        phase: "Fase",
        paused: "En pausa",
        settings: "Configuración",
        theme: "Cambiar tema",
        darkMode: "Modo oscuro",
        language: "Idioma",
        systemSettings: "Configuración del sistema",
        offline: "Servidor inaccesible",
        tasks: "Tablero de tareas",
        projectLibrary: "Biblioteca de proyectos",
        historyProjects: "Proyectos recientes",
        recentProjects: "Proyectos recientes",
        open: "Abrir",
        landingTitle: "Empieza con una idea.",
        landingSubtitle: "Unas pocas palabras bastan para empezar.",
        ideaPlaceholder: "Describe el juego, la herramienta o la experiencia interactiva que quieres crear",
        generate: "Generar"
    },
    it: {
        placeholder: "Inserisci la visione del progetto...",
        newProject: "Nuovo progetto",
        stop: "Ferma progetto",
        resume: "Riprendi progetto",
        active: "In esecuzione",
        idle: "Inattivo",
        stopped: "Fermato",
        chat: "Collaborazione",
        runtime: "Runtime",
        artifacts: "Consegne",
        tokens: "Consumo",
        progress: "Avanzamento",
        phase: "Fase",
        paused: "In pausa",
        settings: "Impostazioni",
        theme: "Cambia tema",
        darkMode: "Modalità scura",
        language: "Lingua",
        systemSettings: "Impostazioni di sistema",
        offline: "Server non raggiungibile",
        tasks: "Bacheca attività",
        projectLibrary: "Libreria progetti",
        historyProjects: "Progetti recenti",
        recentProjects: "Progetti recenti",
        open: "Apri",
        landingTitle: "Inizia da un’idea.",
        landingSubtitle: "Bastano poche parole per cominciare.",
        ideaPlaceholder: "Descrivi il gioco, lo strumento o l’esperienza interattiva che vuoi creare",
        generate: "Genera"
    },
    pt: {
        placeholder: "Insira a visão do projeto...",
        newProject: "Novo projeto",
        stop: "Parar projeto",
        resume: "Retomar projeto",
        active: "Em execução",
        idle: "Ocioso",
        stopped: "Parado",
        chat: "Colaboração",
        runtime: "Tempo de execução",
        artifacts: "Entregáveis",
        tokens: "Consumo",
        progress: "Progresso",
        phase: "Fase",
        paused: "Pausado",
        settings: "Configurações",
        theme: "Alternar tema",
        darkMode: "Modo escuro",
        language: "Idioma",
        systemSettings: "Configurações do sistema",
        offline: "Servidor inacessível",
        tasks: "Quadro de tarefas",
        projectLibrary: "Biblioteca de projetos",
        historyProjects: "Projetos recentes",
        recentProjects: "Projetos recentes",
        open: "Abrir",
        landingTitle: "Comece com uma ideia.",
        landingSubtitle: "Algumas palavras bastam para começar.",
        ideaPlaceholder: "Descreva o jogo, a ferramenta ou a experiência interativa que você quer criar",
        generate: "Gerar"
    }
};

export type Language = keyof typeof translations;

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

// --- Dynamic Agent UI Mapping ---
export const AGENT_UI_MAP: Record<string, { name: string; role: string; x: number; y: number; icon: any; color: string; text: string; border: string; bio: string; layer: AgentLayer; phase: string }> = {
    'beegame': {
        name: 'BeeGame', role: '游戏构建代理', x: center1, y: LAYER_CONFIG.governor.y, icon: BeeIcon,
        color: 'bg-[#D77757]', text: 'text-[#D77757]', border: 'border-[#D77757]/50',
        bio: '核心能力：把想法转成文档、代码、工具调用与可运行项目。',
        layer: 'governor', phase: 'Session'
    },
    // ── Layer 1: Runtime Governor ──────────────────────────
    'logos': {
        name: 'Logos', role: '制作人/编排器', x: center1, y: LAYER_CONFIG.governor.y, icon: Briefcase,
        color: 'bg-blue-500', text: 'text-blue-500', border: 'border-blue-500/50',
        bio: '核心能力：定义秩序。负责全局工作流的编排与意图解析。',
        layer: 'governor', phase: 'P0-P5'
    },
    // ── Layer 2: Cognitive Agents ──────────────────────────
    'metis': {
        name: 'Metis', role: '游戏策划', x: row4(0), y: LAYER_CONFIG.cognitive.y, icon: BookOpen,
        color: 'bg-purple-500', text: 'text-purple-500', border: 'border-purple-500/50',
        bio: '核心能力：构筑规则。专注于 GDD 创建与数值平衡。',
        layer: 'cognitive', phase: 'P1'
    },
    'tecton': {
        name: 'Tecton', role: '架构师', x: row4(1), y: LAYER_CONFIG.cognitive.y, icon: Cpu,
        color: 'bg-indigo-500', text: 'text-indigo-500', border: 'border-indigo-500/50',
        bio: '核心能力：支撑结构。定义代码架构与接口规范。',
        layer: 'cognitive', phase: 'P2'
    },
    'apollo': {
        name: 'Apollo', role: '美术指导', x: row4(2), y: LAYER_CONFIG.cognitive.y, icon: Palette,
        color: 'bg-pink-500', text: 'text-pink-500', border: 'border-pink-500/50',
        bio: '核心能力：审美统筹。统领视觉风格与资产规范。',
        layer: 'cognitive', phase: 'P2'
    },
    'morphe': {
        name: 'Morphe', role: 'UI/UX 设计', x: row4(3), y: LAYER_CONFIG.cognitive.y, icon: Layout,
        color: 'bg-rose-500', text: 'text-rose-500', border: 'border-rose-500/50',
        bio: '核心能力：形态交互。设计 UI 布局与交互体验。',
        layer: 'cognitive', phase: 'P2'
    },
    // ── Layer 3: Implementation Agents ─────────────────────
    'hephaestus': {
        name: 'Hephaestus', role: '工程师', x: row4(0), y: LAYER_CONFIG.implementation.y, icon: Code,
        color: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500/50',
        bio: '核心能力：逻辑实现。编写 C# 脚本与核心业务逻辑。',
        layer: 'implementation', phase: 'P4'
    },
    'sankta': {
        name: 'Sankta', role: 'UI 构建师', x: row4(1), y: LAYER_CONFIG.implementation.y, icon: Zap,
        color: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-500/50',
        bio: '核心能力：UI 实现。负责 Unity UI 构建与动效实现。',
        layer: 'implementation', phase: 'P4'
    },
    'hyle': {
        name: 'Hyle', role: '资产管理', x: row4(2), y: LAYER_CONFIG.implementation.y, icon: Database,
        color: 'bg-orange-500', text: 'text-orange-500', border: 'border-orange-500/50',
        bio: '核心能力：物质生产。管理资产清单与资源同步。',
        layer: 'implementation', phase: 'P3'
    },
    'pneuma': {
        name: 'Pneuma', role: '技术美术', x: row4(3), y: LAYER_CONFIG.implementation.y, icon: Rocket,
        color: 'bg-violet-500', text: 'text-violet-500', border: 'border-violet-500/50',
        bio: '核心能力：优化赋能。性能瓶颈分析与 Shader 优化。',
        layer: 'implementation', phase: 'P4'
    },
    // ── Layer 4: Verification & Build ─────────────────────
    'argus': {
        name: 'Argus', role: '测试工程师', x: row2(0), y: LAYER_CONFIG.verification.y, icon: Shield,
        color: 'bg-red-500', text: 'text-red-500', border: 'border-red-500/50',
        bio: '核心能力：完美守护。执行自动化测试与质量保障。',
        layer: 'verification', phase: 'P5'
    },
    'synthet': {
        name: 'Synthet', role: '构建工程师', x: row2(1), y: LAYER_CONFIG.verification.y, icon: Eye,
        color: 'bg-cyan-500', text: 'text-cyan-500', border: 'border-cyan-500/50',
        bio: '核心能力：封装进化。CI/CD 流水线与多平台打包。',
        layer: 'verification', phase: 'P5'
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
