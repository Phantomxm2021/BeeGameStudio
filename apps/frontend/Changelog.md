# Changelog

## [1.7.5] - 2026-03-25

### Added
- **Deterministic Message ID System**: Implemented a 100% deterministic ID strategy in `chatStore.ts` to solve persistent message duplication.
    - Streaming messages: `streaming-{taskId}-{sender}`
    - Finalized messages: `agent-{taskId}-{sender}-{timestamp}` (using backend-provided server time).
- **Parallel Event Coalescing**: Refactored `updateMessage` and `updateThought` to use stable IDs, ensuring that duplicate WebSocket events (from `React.StrictMode` or multiple connections) always map to the same store entry.

### Changed
- **Store Action Signatures**: Updated `updateMessage` and `updateThought` to prioritize backend-provided timestamps, aligning with the server-side source of truth for message timing.

## [1.7.0] - 2026-03-25

### Refactored
- **RightSidebar Monolith Decomposition**: Decomposed the ~1250-line `RightSidebar.tsx` into modular panels: `ChatPanel`, `TasksPanel`, `ArtifactsPanel`, and `RuntimePanel`.
- **Shared Sidebar Logic**: Centralized task status colors and canonical status helpers into `SidebarUtils.ts` to ensure consistency and reduce code duplication.
- **Artifact Preview**: Extracted the preview modal into a standalone `ArtifactPreviewModal` component.

### Changed
- **Performance Optimization**: Re-enabled `React.StrictMode` after verifying WebSocket and polling stability.
- **Codebase Hygiene**: Deleted the legacy `src/components/Chat/` directory and stripped unused CSS classes from `index.css`.
- **Type Safety**: Improved prop types in `ChatPanel` to correctly handle `RefObject` nullability and resolve linting errors.

### Fixed
- Fixed a polling storm in `DashboardView.tsx` by implementing a debounced refresh strategy for WebSocket events.
- Resolved a re-render loop in `App.tsx` by removing unstable dependencies from the history loading effect.

## [1.6.1] - 2026-03-25

### Fixed
- **Markdown Rendering**: Resolved fragmented "box" styling on languageless code blocks (diagrams/ASCII art) by separating `pre` and `code` component concerns.
- **Languageless Blocks**: Improved block identification in `MarkdownRenderer` to ensure technical diagrams maintain monospaced alignment even without explicit language tags.
- **Test Integrity**: Fixed and expanded `ChatComponents.test.tsx` to guarantee rendering correctness for structured data and various code formats.

## [1.6.0] - 2026-03-25

### Added
- **Real-time Artifact Sync**: Implemented `artifact_created` WebSocket event handler to move from polling to push-based artifact updates.
- **Message Index Mapping**: Introduced O(1) `messageIndexMap` in `chatStore.ts` to replace O(n) streaming lookups, significantly reducing CPU usage during token streaming.
- **LocalStorage Protection**: Added a 500-message cap (`MAX_MESSAGES`) to the chat history to prevent memory/storage overflow in long-running sessions.

### Changed
- **WebSocket Stability**: Refactored `useChat.ts` using the "Latest Refs" pattern to eliminate dependency churn and prevent unintended WebSocket reconnections.
- **Protocol Alignment**: Updated `MessageValidator` and `useWebSocket` tests to align with v1.4.0 protocol decisions (lenient `task_id` validation).

### Fixed
- Resolved a critical issue where every chat store update triggered a full array traversal, causing UI lag during high-concurrency token streaming.
- Fixed WebSocket reconnection loops by decoupling the message handler from the unstable component lifecycle.

## [1.5.0] - 2026-03-22

### Added
- **Artifact Processing Utility**: Created `ArtifactProcessor` to handle stripping of internal metadata markers (`<!-- xxx -->`).
- **Artifact Cards in Chat**: Implemented `ArtifactCard` component to display document artifacts as premium interactive cards in the chat interface. Now includes intelligent metadata extraction for GDD documents (titles and summaries).
- **Click-to-Preview**: Integrated chat cards with the sidebar preview system, allowing users to expand documents directly from the conversation.
- **Direct Preview Fallback**: Fixed an issue where clicking cards without a backend artifact ID would fail. The preview now correctly falls back to showing the message content directly.
- **System-Correct Type Propagation**: Replaced brute-force heuristics with a robust propagation model. Message types and document flags (`isDocument`, `artifactId`) are now correctly passed from the server through the WebSocket layer and history normalization to the UI.

### Changed
- **Marker Hiding**: Updated `MarkdownRenderer` to automatically hide internal markers in artifact previews.
- **Clean Downloads**: Refactored artifact download logic to strip metadata markers before saving, ensuring users receive clean documentation.
- **Refined Card UI**: Redesigned `ArtifactCard` to match user-provided sketches, focusing on simplicity, clear hierarchy, and prominent preview calls-to-action.

### Fixed
- Improved the visual consistency and interactivity of generated artifacts in the Demiurge dashboard.

## [1.4.1] - 2026-03-15

### Added
- Created `ChatComponents.tsx` to encapsulate memoized `MessageItem` and `MarkdownRenderer` components.

### Refactored
- **RightSidebar Optimization**: Decoupled chat rendering from the main sidebar component to prevent unnecessary re-renders of the entire message list.
- **Polling Efficiency**: Implemented visibility-aware and status-dependent polling in `DashboardView.tsx` to reduce background CPU cycles.
- **Animation Control**: Added conditional animation gating in `CanvasView.tsx` to pause heavy SVG animations when the system is idle.

### Fixed
- Improved overall frontend performance and reduced computer heating during long sessions.

## [1.4.0] - 2026-02-28

### Added
- Integrated `approvePlan` API for user-driven plan approval flow.
- Added `plan_approved` WebSocket event handler to track decentralized approval state.
- Implemented "Approval Required" banner in the chat UI for GDD/Plan approval tasks.

### Fixed
- **WebSocket Validation Robustness**: Upgraded `MessageValidator` to treat missing `task_id` as a warning instead of a hard error, and improved error logging by including raw message data.
- **WebSocket Validation**: Fixed a validation error where `plan_approved` and `thought` messages were rejected due to type mismatches.
- **Real-time Telemetry**: Implemented hybrid refresh (polling + WebSocket triggers) for project progress and token usage.
- **Task-aware Token Tracking**: Optimized token usage accumulation to track per-task and aggregate across parallel agent activity.
- **State Recovery & Consistency**: Implemented robust resynchronization logic for server restarts and initial project loads. Added visual "Syncing..." indicator in TopBar.
- **Project Library Entry Point**: Added a dedicated "Project Library" floating entry point on the Landing View with a premium glassmorphism list for switching between existing projects.
- **Global Theme Management**: Refactored theme state to `systemStore` with persistence, fixing a bug where theme settings were not synchronized across different views.
- **Menu Dismissal (UX)**: Implemented transparent backdrops for settings menus to allow closing by clicking anywhere outside.
- **Visual Polish**: Fixed dropdown arrow visibility in dark mode.
- **Consolidated Project Actions (Phase 11)**: Removed redundant chevron and unified all project actions into a single, clean "More" button with hover-reveal.
- **Atomic Bootstrap Refactoring (Phase 12)**: Implemented the `bootstrap-from-idea` atomic project creation flow to align with the updated integration guide.
- **Project Renaming (Phase 9)**: Added support for the `project_renamed` WebSocket event, ensuring AI-generated project titles are updated in the UI without a page reload.
- **Documentation Update**: Added `project_renamed` event to the frontend integration guide.

- Fixed inconsistent status detection for stopped and resuming tasks.
- **Fixed Icon Reference Error**: Resolved `ReferenceError` in `LandingView.tsx` by adding missing `MoreHorizontal` and `Trash2` icon imports.

### Refactored
- **State Machine Formalization**: Aligned `DashboardView` with the integration guide's state machine (idle, running, paused, waiting_approval, stopped, finished).
- **Task-based Aggregation**: Refactored `chatStore` to use `taskId` for grouping streaming tokens.
- **State Synchronization**: Implemented `syncAfterReconnect` to align local state with backend after WebSocket interruptions.
- **Component Prop Synchronization**: Updated `TopBar` and `SideMenu` to support the expanded state.
- Updated WebSocket reconnection to use exponential backoff (1s to 30s).


## [1.3.1] - 2026-02-28


### Added
- Real-time artifacts listing from backend API.

### Changed
- Enabled text selection for message content.
- Improved agent node status visualization.


All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-02-24

### Added
- Conversational Clarification Mode: Introduced a new intermediate chat flow overlay (`ClarificationOverlay.tsx`) when waiting for the LLM to respond or clarify the user's requirement.
- Implemented a full-screen loading state with an animated Demiurge logo and "Thinking..." text before the agent responds.

### Changed
- Refactored `LandingView.tsx` to match the "Demiurge Team" text and updated the input submission animation to a focused scale/fade effect.
- Updated `DashboardView.tsx` to conditionally render the `ClarificationOverlay` and hide the main workspace sidebars until the clarification phase completes.

## [0.3.0] - 2026-02-22

### Added
- Collapsible `<thought>` tag support in chat messages for LLM reasoning.
- Inline error blocks for server-side errors, replacing persistent toast notifications.
- Scroll-wheel zoom support for the Canvas view.
- Editable project name in TopBar (double-click to rename).
- Language selection dropdown in SideMenu, replacing the toggle pill.
- Animated SVG "DemiurgeLogo" themed around multi-agent orchestration.
- Send icon button inside the Landing View input box.
- Game Dev Atmosphere to Landing View: Clean, static semi-transparent engine viewport grid.
- Restored Language selection and Theme toggles directly on the Landing View using the dashboard's unified SideMenu styling.

### Changed
- Agent Map UI (DashboardView): Completely redesigned `AgentsConfig` layout to a Top-Down Vertical pipeline. Replaced 1-to-1 interconnected spaghetti lines with a clean, centralized SVG Data Bus structure to handle active `commFlow` routing orthogonally.
- Refactored Landing View input box: semi-circular ends (rounded-full), fixed height (52px), and responsive max-width (685px).
- Refactored Canvas dragging to use `useMotionValue` for high-performance, lag-free interaction.
- Changed default Canvas drag trigger to Left Mouse Button.
- Project creation now defaults the name to "Untitled" instead of using the prompt idea.
- TopBar status indicator switched from text badges to a color-coded animated dot.
- WebSocket callback handling re-architected to prevent infinite connection loops.

### Fixed
- Dark mode text rendering bug in chat bubbles (white-on-white text).
- Dark mode synchronization issues across the app via root `<html>` tagging.
- Missing `useState` and `useRef` imports in several components.
- Syntax errors in chat message mapping logic.
