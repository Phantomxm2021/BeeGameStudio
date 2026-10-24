import { useEffect, useRef, useState } from 'react';
import { Button } from '../beui/project-button';
import {
  getBeePlayOverview,
  saveBeePlayRecommendations,
  type BeePlayMetrics,
  type BeePlayOverview,
  type BeePlayRecommendation,
} from '../../../../game-portal/src/admin-api';

const today = () => new Date().toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
const inputClass =
  'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
const format = (n: number) => Number(n).toLocaleString();
const ctr = (m: BeePlayMetrics) =>
  m.impressions ? `${((m.clicks / m.impressions) * 100).toFixed(1)}%` : '—';

export function BeePlayAdminPanel({ language }: { language: string }) {
  const zh = language.startsWith('zh');
  const t = (cn: string, en: string) => (zh ? cn : en);
  const [tab, setTab] = useState<'featured' | 'stats'>('featured');
  const [from, setFrom] = useState(weekAgo),
    [to, setTo] = useState(today);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState({
    from: weekAgo(),
    to: today(),
    query: '',
    page: 0,
    project: '',
  });
  const [selectedGame, setSelectedGame] = useState<BeePlayRecommendation | null>(null);
  const [overview, setOverview] = useState<BeePlayOverview | null>(null);
  const [featured, setFeatured] = useState<BeePlayRecommendation[] | null>(null);
  const initialized = useRef(false);
  const [dirty, setDirty] = useState(false),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setOverview(null);
    setError('');
    getBeePlayOverview(filter)
      .then((data) => {
        if (disposed) return;
        setOverview(data);
        if (!initialized.current) {
          setFeatured(data.featured);
          initialized.current = true;
        }
      })
      .catch(() => {
        if (!disposed)
          setError(
            zh
              ? '无法加载管理数据，请稍后重试。'
              : 'Unable to load management data. Please try again.'
          );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [filter, refresh, zh]);
  const edit = (next: BeePlayRecommendation[]) => {
    setFeatured(next);
    setDirty(true);
    setSaved(false);
  };
  const move = (index: number, offset: number) => {
    const next = [...(featured ?? [])];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    edit(next);
  };
  const save = async () => {
    if (!featured) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await saveBeePlayRecommendations(featured.map((g) => g.project_id));
      setDirty(false);
      setSaved(true);
    } catch {
      setError(
        t(
          '推荐未保存，请重试；若游戏已取消发布，请先移除。',
          'Recommendations were not saved. Retry, or remove games that are no longer published.'
        )
      );
    } finally {
      setSaving(false);
    }
  };
  const labels = [
    t('访问次数', 'Visits'),
    t('游玩次数', 'Plays'),
    t('独立访客', 'Unique visitors'),
    t('Banner 曝光', 'Banner impressions'),
    t('Banner 点击', 'Banner clicks'),
    t('点击率', 'CTR'),
  ];
  const values = (m: BeePlayMetrics) => [
    format(m.visits),
    format(m.plays),
    format(m.visitors),
    format(m.impressions),
    format(m.clicks),
    ctr(m),
  ];
  const metricsCells = (m: BeePlayMetrics) =>
    values(m).map((value, i) => (
      <td key={i} className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
        {value}
      </td>
    ));
  return (
    <section className="space-y-5">
      <div className="flex gap-2" role="tablist" aria-label="BeePlay">
        <Button
          role="tab"
          aria-selected={tab === 'featured'}
          variant={tab === 'featured' ? 'default' : 'outline'}
          onClick={() => setTab('featured')}
        >
          {t('Banner 推荐', 'Banner recommendations')}
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'stats'}
          variant={tab === 'stats' ? 'default' : 'outline'}
          onClick={() => setTab('stats')}
        >
          {t('数据统计', 'Statistics')}
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error}{' '}
          <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
            {t('重新加载', 'Reload')}
          </Button>
        </div>
      )}
      {tab === 'featured' ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t(
              '最多推荐 5 款已发布游戏，按此顺序显示在 BeePlay 首页。留空则隐藏 Banner。',
              'Recommend up to 5 published games in this order on the BeePlay homepage. An empty list hides the banner.'
            )}
          </p>
          <ol className="space-y-2">
            {featured?.map((game, index) => (
              <li
                key={game.project_id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3"
              >
                <span className="text-sm text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 break-words text-sm">{game.title}</span>
                <Button
                  variant="outline"
                  disabled={saving || index === 0}
                  aria-label={t('上移 ', 'Move up ') + game.title}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="outline"
                  disabled={saving || index === featured.length - 1}
                  aria-label={t('下移 ', 'Move down ') + game.title}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => edit(featured.filter((g) => g.project_id !== game.project_id))}
                >
                  {t('移除', 'Remove')}
                </Button>
              </li>
            ))}
          </ol>
          {featured?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t(
                '尚未设置推荐。从下方已发布游戏中添加。',
                'No recommendations yet. Add published games below.'
              )}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? t('保存中…', 'Saving…') : t('保存推荐', 'Save recommendations')}
            </Button>
            <span role="status" className="text-sm text-muted-foreground">
              {saved
                ? t('推荐已保存', 'Recommendations saved')
                : dirty
                  ? t('有未保存的更改', 'Unsaved changes')
                  : ''}
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t(
              '按 UTC 日期统计，最多 93 天。游玩 = 游戏内首次真实点击或按键，同一浏览器标签会话内同一游戏只计一次（闲置 30 分钟或满 24 小时后重新计）。独立访客按浏览器匿名标识去重，非登录人数。历史数据不补录。',
              'UTC dates, up to 93 days. A play is the first real click or key press inside a game, once per game per tab session (resets after 30 minutes idle or 24 hours). Unique visitors use an anonymous browser identifier, not accounts. No historical backfill.'
            )}
          </p>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setFilter((f) => ({ ...f, from, to }));
              setRefresh((n) => n + 1);
            }}
          >
            <label className="grid gap-1 text-sm">
              {t('开始日期', 'From')}
              <input
                type="date"
                required
                value={from}
                max={to}
                className={inputClass}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              {t('结束日期', 'To')}
              <input
                type="date"
                required
                value={to}
                min={from}
                max={today()}
                className={inputClass}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={loading}>
              {t('查询', 'Apply')}
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {t('统计范围：', 'Scope: ')}
              {selectedGame?.title || t('全部游戏', 'All games')}
            </span>
            {selectedGame && (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedGame(null);
                  setFilter((f) => ({ ...f, project: '' }));
                }}
              >
                {t('查看全部', 'Show all')}
              </Button>
            )}
          </div>
          {!loading && overview && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {values(overview.totals).map((value, i) => (
                  <div key={i} className="rounded-xl border border-border p-4">
                    <p className="text-xs text-muted-foreground">{labels[i]}</p>
                    <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <caption className="p-3 text-left font-medium">
                    {t('每日数据', 'Daily statistics')}
                  </caption>
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left">{t('日期', 'Date')}</th>
                      {labels.map((label) => (
                        <th key={label} className="whitespace-nowrap px-3 py-2 text-right">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {overview.daily.map((day) => (
                      <tr key={day.day} className="border-t border-border">
                        <td className="whitespace-nowrap px-3 py-3">{day.day}</td>
                        {metricsCells(day)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!overview.daily.length && (
                  <p className="p-4 text-sm text-muted-foreground">
                    {t('此范围暂无数据。', 'No data for this range.')}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter((f) => ({ ...f, query: query.trim(), page: 0 }));
        }}
      >
        <input
          aria-label={t('搜索已发布游戏', 'Search published games')}
          placeholder={t('搜索已发布游戏', 'Search published games')}
          maxLength={100}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button type="submit">{t('搜索', 'Search')}</Button>
      </form>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('正在加载…', 'Loading…')}
        </p>
      ) : (
        overview && (
          <>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">{t('已发布游戏', 'Published game')}</th>
                    {tab === 'stats' ? (
                      labels.map((label) => (
                        <th key={label} className="whitespace-nowrap px-3 py-2 text-right">
                          {label}
                        </th>
                      ))
                    ) : (
                      <th className="px-3 py-2 text-right">{t('累计游玩', 'Lifetime plays')}</th>
                    )}
                    <th className="px-3 py-2">
                      <span className="sr-only">{t('操作', 'Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {overview.games.map((game) => (
                    <tr key={game.project_id} className="border-t border-border">
                      <td className="min-w-36 px-3 py-3">
                        <p>{game.title}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{game.author_name}</p>
                      </td>
                      {tab === 'stats' ? (
                        metricsCells(game)
                      ) : (
                        <td className="px-3 py-3 text-right tabular-nums">
                          {format(game.play_count)}
                        </td>
                      )}
                      <td className="px-3 py-3">
                        {tab === 'featured' ? (
                          <Button
                            variant="outline"
                            disabled={
                              !featured ||
                              saving ||
                              featured.length >= 5 ||
                              featured.some((g) => g.project_id === game.project_id)
                            }
                            onClick={() => edit([...(featured ?? []), game])}
                          >
                            {featured?.some((g) => g.project_id === game.project_id)
                              ? t('已推荐', 'Added')
                              : t('添加', 'Add')}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedGame(game);
                              setFilter((f) => ({ ...f, project: game.project_id }));
                            }}
                          >
                            {t('明细', 'Details')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!overview.games.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('没有匹配的已发布游戏。', 'No matching published games.')}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                {t('共 ', '')}
                {overview.totalGames}
                {t(' 款游戏', ' games')}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={filter.page === 0}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page - 1 }))}
                >
                  {t('上一页', 'Previous')}
                </Button>
                <span>{filter.page + 1}</span>
                <Button
                  variant="outline"
                  disabled={(filter.page + 1) * 24 >= overview.totalGames}
                  onClick={() => setFilter((f) => ({ ...f, page: f.page + 1 }))}
                >
                  {t('下一页', 'Next')}
                </Button>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
