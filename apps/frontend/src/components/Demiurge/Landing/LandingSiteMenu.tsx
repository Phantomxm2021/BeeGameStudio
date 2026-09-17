import { useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, CircleHelp, FileText, Globe2, Grip, MessageSquareHeart, Rss, ShieldCheck } from 'lucide-react';
import { FeedbackWidget } from '../../motion/feedback-widget';
import { MorphPopover, MorphPopoverContent, MorphPopoverTrigger } from '../../beui/registry/components/motion/popover-morph';

export type LandingPage = 'home' | 'blog' | 'learn' | 'about';

interface LandingSiteMenuProps {
  language: string;
  onNavigate: (page: LandingPage) => void;
  onOpenLegal: (document: 'terms' | 'privacy') => void;
}

const socialPlatforms = [
  'X', 'Discord', 'TikTok', 'YouTube', 'Reddit', 'GitHub', 'Bilibili', '微信公众号',
  '抖音', '微博', '小红书', '即刻', '快手', '知乎', 'QQ',
];

export function LandingSiteMenu({ language, onNavigate, onOpenLegal }: LandingSiteMenuProps) {
  const [open, setOpen] = useState(false);
  const [showSocial, setShowSocial] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const zh = language.startsWith('zh');
  const labels = zh ? {
    menu: '网站菜单', blog: '博客', learn: '学习中心', social: '社交媒体', feedback: '反馈', about: '关于', terms: '服务条款', privacy: '隐私政策',
    feedbackTitle: '告诉我们你的想法', feedbackPlaceholder: '写下问题、建议或想法…', comingSoon: '官方账号即将上线',
  } : {
    menu: 'Site menu', blog: 'Blog', learn: 'Learn', social: 'Social media', feedback: 'Feedback', about: 'About', terms: 'Terms of service', privacy: 'Privacy policy',
    feedbackTitle: 'Tell us what you think', feedbackPlaceholder: 'Share an issue, idea, or suggestion…', comingSoon: 'Official account coming soon',
  };

  const choose = (action: () => void) => {
    setOpen(false);
    setShowSocial(false);
    action();
  };

  return (
    <>
      <MorphPopover open={open} onOpenChange={setOpen}>
        <MorphPopoverTrigger>
          <button type="button" aria-label={labels.menu} className="grid size-8 place-items-center bg-transparent text-white transition hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80">
            <Grip className="size-5" strokeWidth={3} />
          </button>
        </MorphPopoverTrigger>
        <MorphPopoverContent side="bottom" align="end" sideOffset={10} radius={16} className="z-[140] w-64 overflow-hidden rounded-2xl border border-white/45 bg-white/95 p-2 text-slate-900 shadow-[0_20px_60px_rgba(0,0,0,.24)] backdrop-blur-xl">
          <div role="menu" aria-label={labels.menu}>
            <MenuItem icon={<Rss />} label={labels.blog} onClick={() => choose(() => onNavigate('blog'))} />
            <MenuItem icon={<BookOpen />} label={labels.learn} onClick={() => choose(() => onNavigate('learn'))} />
            <button type="button" role="menuitem" onClick={() => setShowSocial(value => !value)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-slate-900/6">
              <Globe2 className="size-4" /><span className="flex-1">{labels.social}</span><ChevronDown className={`size-4 transition-transform ${showSocial ? 'rotate-180' : ''}`} />
            </button>
            {showSocial ? <div className="mx-2 mb-1 grid grid-cols-2 gap-1 border-l border-slate-200 pl-3 pt-1">{socialPlatforms.map(platform => <span key={platform} title={labels.comingSoon} className="rounded-lg px-2 py-1.5 text-xs text-slate-500">{platform}</span>)}</div> : null}
            <div className="my-1 h-px bg-slate-200" />
            <MenuItem icon={<MessageSquareHeart />} label={labels.feedback} onClick={() => choose(() => setFeedbackOpen(true))} />
            <MenuItem icon={<CircleHelp />} label={labels.about} onClick={() => choose(() => onNavigate('about'))} />
            <MenuItem icon={<FileText />} label={labels.terms} onClick={() => choose(() => onOpenLegal('terms'))} />
            <MenuItem icon={<ShieldCheck />} label={labels.privacy} onClick={() => choose(() => onOpenLegal('privacy'))} />
          </div>
        </MorphPopoverContent>
      </MorphPopover>
      <div className="pointer-events-none fixed inset-0 z-[150]">
        <FeedbackWidget open={feedbackOpen} onOpenChange={setFeedbackOpen} hideTrigger title={labels.feedbackTitle} placeholder={labels.feedbackPlaceholder} />
      </div>
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-slate-900/6">{icon}<span>{label}</span></button>;
}
