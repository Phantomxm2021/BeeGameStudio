import type { Locale, Messages } from "./types";

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
};

export const messages: Record<Locale, Messages> = {
  "zh-CN": {
    meta: {
      title: "Bee Game Studio — 把想法，做成游戏。",
      description: "从说出第一句话，到第一次亲手玩起自己的游戏。",
      ogTitle: "Bee Game Studio — 把想法，做成游戏。",
      ogDescription: "你说出想做什么，Bee Game Studio 让它成为一款你可以亲自试玩的游戏。",
    },
    nav: { story: "产品", belief: "我们相信", join: "加入优先体验名单", language: "选择语言", primary: "主要导航", menu: "打开导航" },
    hero: { title: "把想法，做成游戏。", body: "从说出第一句话，到第一次亲手玩起自己的游戏。Bee Game Studio 把想象变成一款你可以亲自试玩的游戏。", note: "不是看起来像游戏。是你可以玩的游戏。", continue: "看看它如何发生", imageAlt: "从原型关卡到可玩游戏的手绘游戏场景" },
    manifesto: { eyebrow: "好想法，不该停在开始之前", title: "你不是没有能力，", muted: "只是缺少一支团队。", body: ["你知道自己想玩的感觉，想留下的余韵，也知道朋友会为什么记住它。", "Bee Game Studio 把那些只有你说得清的东西，变成一款你可以亲自试玩、继续打磨的游戏。"] },
    moment: { eyebrow: "一句话，变成一款游戏", quote: "我想做一款关于深夜便利店的游戏。", detail: "现在，亲自玩上一遍。", body: "你只需要说清楚想做什么。Bee Game Studio 把感觉、场景和选择，一点点变成可以玩的游戏。", conclusion: ["从一句想法，", "到一款亲手玩的游戏。"], imageAlt: "雨夜里亮着暖光的微缩便利店游戏场景", ruleLabels: ["雨夜", "暖光", "沉默的客人"], stages: [{ label: "听懂想法", text: "我想做一款关于深夜便利店的游戏。" }, { label: "找到感觉", text: "雨夜、暖光、沉默的客人，成为这款游戏的感觉。" }, { label: "让场景成形", text: "便利店、角色和选择，逐渐变成你想要的样子。" }, { label: "亲自试玩", text: "现在，你可以亲自玩一遍这段故事。" }] },
    change: { title: ["不只是想象。", "是一款你可以亲自玩的游戏。"], edits: ["第一次试玩，你就知道它是不是你想要的样子。", "你能把“不对”改成“就是这样”。", "你能把它交给朋友，看见他们怎么玩。"], body: "真正重要的，不是它如何被做出来，而是它有没有变成你愿意分享的那款游戏。" },
    ownership: { eyebrow: "你始终决定它成为什么", title: ["制作可以交给 AI。", "决定始终属于你。"], stages: [{ time: "你想留下什么", title: "由你说出来", body: "那是游戏最初的感觉。" }, { time: "玩家感受到什么", title: "由你确认", body: "每一个选择，都更接近你想表达的感觉。" }, { time: "这一版先做到哪里", title: "由你决定", body: "先让最重要的部分发生。" }, { time: "最后它属于谁", title: "始终属于你", body: "这是你做的游戏。" }] },
    vision: { eyebrow: "我们相信", title: ["每个人都应该有机会", "把想法变成"], emphasis: "自己的游戏。", body: ["不需要先成为程序员、美术师或开发者。只要你知道自己想让玩家感受到什么，就可以开始。", "Bee Game Studio 想让更多人把“我有一个想法”，变成“这是我做的游戏”。"] },
    waitlist: { title: ["你的第一款游戏，", "会从哪句话开始？"], body: "Bee Game Studio 正在准备上线。加入优先体验名单，和第一批创作者一起，把一个想法做成游戏。", name: "怎么称呼你", email: "你的邮箱", persona: "选择你的身份", personas: { idea: "我有一个游戏想法", creator: "我是独立游戏创作者", investor: "我是投资人或合作伙伴" }, submit: "加入优先体验名单", submitting: "正在提交…", successTitle: "已经加入优先体验名单", duplicateTitle: "你已经在名单里了", errorTitle: "这次没有提交成功", success: "已经记下你的名字，开放体验时见。", duplicate: "这个邮箱已经在优先体验名单中。", error: "暂时无法提交，请稍后再试。", close: "关闭", privacy: "我们只会发送与 Bee Game Studio 产品进展和体验邀请有关的消息。" },
  },
  en: {
    meta: {
      title: "Bee Game Studio — Your idea. A real game.",
      description: "From your first sentence to the first time you play your own game.",
      ogTitle: "Bee Game Studio — Your idea. A real game.",
      ogDescription: "Say what you want to make. Bee Game Studio turns it into a game you can play for yourself.",
    },
    nav: { story: "Product", belief: "What we believe", join: "Join the early access list", language: "Choose language", primary: "Primary navigation", menu: "Open navigation" },
    hero: { title: "Your idea. A real game.", body: "From your first sentence to the first time you play it. Bee Game Studio turns a thought into a game you can play, shape, and share.", note: "Not a picture of a game. A game you can play.", continue: "See how it happens", imageAlt: "A hand-painted game level moving from prototype blocks to a playable scene" },
    manifesto: { eyebrow: "Good ideas should not stop before they begin", title: "You were never short", muted: "of imagination.", body: ["You know the feeling you want to create, the moment you want players to remember, and why a friend would come back to it.", "Bee Game Studio turns the things only you can describe into a game you can play, test, and keep shaping."] },
    moment: { eyebrow: "One sentence. A game you can play.", quote: "I want to make a game about a late-night convenience store.", detail: "Now, play it for yourself.", body: "You only need to say what you want to make. Bee Game Studio turns the feeling, the scene, and the choices into a game you can play.", conclusion: ["From one idea,", "to a game you can play."], imageAlt: "A miniature late-night convenience store glowing warmly in the rain", ruleLabels: ["Rain", "Warm light", "A quiet customer"], stages: [{ label: "Understand the idea", text: "I want to make a game about a late-night convenience store." }, { label: "Find the feeling", text: "Rain, warm light, and a quiet customer become the feeling of the game." }, { label: "Shape the scene", text: "The store, the character, and the choices begin to take shape your way." }, { label: "Play it yourself", text: "Now you can play this story for yourself." }] },
    change: { title: ["Not just a thought.", "A game you can play for yourself."], edits: ["Play the first version and know what it should become.", "Turn “not quite right” into “that’s it.”", "Hand it to a friend and watch how they play."], body: "What matters is not how it was made. It is whether it became the game you want to share." },
    ownership: { eyebrow: "You decide what it becomes", title: ["Let AI handle the making.", "You keep the decisions."], stages: [{ time: "What you want to keep", title: "You say it", body: "That is where the feeling begins." }, { time: "What players should feel", title: "You confirm it", body: "Every choice moves toward the feeling you want." }, { time: "How far this version goes", title: "You decide", body: "Make the part that matters most happen first." }, { time: "Who it belongs to", title: "It stays yours", body: "This is the game you made." }] },
    vision: { eyebrow: "What we believe", title: ["Everyone should have the chance", "to turn an idea into"], emphasis: "their own game.", body: ["You should not have to become a programmer, artist, or developer first. If you know what you want players to feel, you can begin.", "Bee Game Studio helps more people move from “I have an idea” to “I made this game.”"] },
    waitlist: { title: ["Your first game", "starts with one sentence."], body: "Bee Game Studio is getting ready to launch. Join the early access list and be among the first creators to turn an idea into a game.", name: "Your name", email: "Your email", persona: "Choose what describes you", personas: { idea: "I have an idea for a game", creator: "I am an independent game creator", investor: "I am an investor or partner" }, submit: "Join the early access list", submitting: "Joining…", successTitle: "You’re on the early access list", duplicateTitle: "You’re already on the list", errorTitle: "We couldn’t join you this time", success: "You are on the list. See you when early access opens.", duplicate: "This email is already on the early access list.", error: "We could not submit this right now. Please try again.", close: "Close", privacy: "We will only send updates about Bee Game Studio and early-access invitations." },
  },
  ja: {
    meta: {
      title: "Bee Game Studio — アイデアを、ゲームへ。",
      description: "最初のひと言から、初めて遊ぶ瞬間まで。",
      ogTitle: "Bee Game Studio — アイデアを、ゲームへ。",
      ogDescription: "つくりたいものを言葉にすると、Bee Game Studioが自分で遊べるゲームに変えます。",
    },
    nav: { story: "プロダクト", belief: "私たちが信じること", join: "先行体験に登録", language: "言語を選ぶ", primary: "メインナビゲーション", menu: "ナビゲーションを開く" },
    hero: { title: "アイデアを、ゲームへ。", body: "最初のひと言から、初めて遊ぶ瞬間まで。Bee Game Studioは、想像を自分で遊べるゲームに変えます。", note: "ゲームらしく見えるだけではない。実際に遊べるゲームを。", continue: "どう始まるかを見る", imageAlt: "プロトタイプのゲームステージが遊べる場面へ変わっていく様子" },
    manifesto: { eyebrow: "いいアイデアを、始める前に止めない", title: "足りなかったのは、", muted: "想像力ではない。", body: ["どんな感覚を残したいか、プレイヤーに何を覚えてほしいか、あなたにはわかっている。", "Bee Game Studioは、あなただけが言葉にできるものを、実際に遊び、磨き続けられるゲームに変えます。"] },
    moment: { eyebrow: "ひとつの言葉が、遊べるゲームになる", quote: "深夜のコンビニを舞台にしたゲームをつくりたい。", detail: "さあ、実際に遊んでみてください。", body: "つくりたいものを言葉にする。それだけで、Bee Game Studioが空気感、場面、選択を遊べるゲームに変えていきます。", conclusion: ["最初のひと言から、", "初めて遊ぶ瞬間まで。"], imageAlt: "雨の夜に暖かな光を灯すミニチュアのコンビニゲーム場面", ruleLabels: ["雨の夜", "暖かな光", "無口な客"], stages: [{ label: "アイデアを受け取る", text: "深夜のコンビニを舞台にしたゲームをつくりたい。" }, { label: "感じを見つける", text: "雨の夜、暖かな光、無口な客。物語の空気が見えてくる。" }, { label: "場面を形にする", text: "コンビニ、人物、選択が、あなたの思い描いた形になっていく。" }, { label: "自分で遊ぶ", text: "コンビニの物語を、自分で遊んでみる。" }] },
    change: { title: ["想像だけではない。", "自分で遊べるゲームになる。"], edits: ["最初のプレイで、あるべき姿が見えてくる。", "「違う」を「これだ」に変えられる。", "友人に渡して、どんなふうに遊ぶかを見られる。"], body: "大切なのは、どうつくられたかではありません。あなたが誰かに遊んでほしいと思えるゲームになったかどうかです。" },
    ownership: { eyebrow: "何になるかを決めるのは、あなた", title: ["制作はAIに任せても、", "決めるのはあなた。"], stages: [{ time: "残したいもの", title: "あなたが言葉にする", body: "ゲームの最初の感覚が、ここから始まる。" }, { time: "感じてほしいこと", title: "あなたが確かめる", body: "ひとつひとつの選択を、あなたの描きたい方向へ。" }, { time: "この版で伝えること", title: "あなたが決める", body: "大切な部分から始める。" }, { time: "誰の作品か", title: "あなたのものとして残る", body: "これは、あなたがつくったゲーム。" }] },
    vision: { eyebrow: "私たちが信じること", title: ["誰もがアイデアを", "自分の"], emphasis: "ゲームにできる。", body: ["先にプログラマーやアーティスト、開発者になる必要はありません。プレイヤーに感じてほしいことがあれば、始められます。", "Bee Game Studioは「アイデアがある」を「これは自分のゲームだ」へつなぎます。"] },
    waitlist: { title: ["あなたの最初のゲームは、", "どんなひと言から始まりますか？"], body: "Bee Game Studioは公開に向けて準備中です。先行体験に登録して、最初のクリエイターのひとりになってください。", name: "お名前", email: "メールアドレス", persona: "あなたに近いものを選ぶ", personas: { idea: "ゲームのアイデアがある", creator: "インディーゲーム制作者", investor: "投資家・パートナー" }, submit: "先行体験に登録", submitting: "登録中…", successTitle: "先行体験リストに登録しました", duplicateTitle: "すでに登録されています", errorTitle: "登録できませんでした", success: "登録しました。先行体験のご案内をお待ちください。", duplicate: "このメールアドレスはすでに登録されています。", error: "現在登録できません。時間をおいてもう一度お試しください。", close: "閉じる", privacy: "Bee Game Studioの体験案内に関するメールのみお送りします。" },
  },
  ko: {
    meta: {
      title: "Bee Game Studio — 아이디어를, 게임으로.",
      description: "첫 문장에서 처음 플레이하는 순간까지.",
      ogTitle: "Bee Game Studio — 아이디어를, 게임으로.",
      ogDescription: "만들고 싶은 것을 말해 주세요. Bee Game Studio가 직접 플레이할 수 있는 게임으로 만듭니다.",
    },
    nav: { story: "제품", belief: "우리가 믿는 것", join: "얼리 액세스 신청", language: "언어 선택", primary: "주요 탐색", menu: "탐색 메뉴 열기" },
    hero: { title: "아이디어를, 게임으로.", body: "첫 문장에서 처음 플레이하는 순간까지. Bee Game Studio는 떠오른 생각을 직접 플레이할 수 있는 게임으로 만듭니다.", note: "게임처럼 보이는 것이 아닙니다. 플레이할 수 있는 게임입니다.", continue: "어떻게 시작되는지 보기", imageAlt: "프로토타입 게임 레벨이 실제로 플레이할 수 있는 장면으로 바뀌는 모습" },
    manifesto: { eyebrow: "좋은 아이디어는 시작도 전에 멈추면 안 됩니다", title: "당신에게 부족했던 것은", muted: "상상력이 아니었습니다.", body: ["어떤 느낌을 남기고 싶은지, 플레이어가 무엇을 기억하길 바라는지 당신은 알고 있습니다.", "Bee Game Studio는 당신만 설명할 수 있는 생각을 직접 플레이해 보고, 계속 다듬어 갈 수 있는 게임으로 만듭니다."] },
    moment: { eyebrow: "한 문장이, 플레이할 수 있는 게임이 됩니다", quote: "심야 편의점을 배경으로 한 게임을 만들고 싶어요.", detail: "이제 직접 플레이해 보세요.", body: "무엇을 만들고 싶은지만 말해 주세요. Bee Game Studio가 그 느낌과 장면, 선택을 플레이할 수 있는 게임으로 만듭니다.", conclusion: ["첫 문장에서", "처음 플레이하는 순간까지."], imageAlt: "비 내리는 밤 따뜻한 불빛이 켜진 미니어처 편의점 게임 장면", ruleLabels: ["비 오는 밤", "따뜻한 불빛", "말없는 손님"], stages: [{ label: "아이디어 이해하기", text: "심야 편의점을 배경으로 한 게임을 만들고 싶어요." }, { label: "느낌 찾기", text: "비 오는 밤, 따뜻한 불빛, 말없는 손님이 이 게임의 분위기가 됩니다." }, { label: "장면 만들기", text: "편의점과 인물, 선택이 당신의 상상대로 모습을 갖춥니다." }, { label: "직접 플레이", text: "편의점 이야기를 직접 플레이해 보세요." }] },
    change: { title: ["단순한 상상이 아닙니다.", "직접 플레이할 수 있는 게임입니다."], edits: ["첫 플레이에서, 이 게임이 어떤 모습이어야 하는지 알게 됩니다.", "‘아직 아니야’를 ‘바로 이거야’로 바꿉니다.", "친구에게 건네고, 친구가 어떻게 플레이하는지 봅니다."], body: "중요한 것은 어떻게 만들어졌는지가 아닙니다. 누군가에게 플레이해 달라고 말하고 싶은 게임이 되었는지입니다." },
    ownership: { eyebrow: "무엇이 될지는 언제나 당신이 정합니다", title: ["제작은 AI에게 맡겨도", "결정은 당신이 합니다."], stages: [{ time: "남기고 싶은 것", title: "당신이 말합니다", body: "그곳에서 감정이 시작됩니다." }, { time: "플레이어가 느낄 것", title: "당신이 확인합니다", body: "모든 선택이, 당신이 그리고 있는 방향을 향합니다." }, { time: "이번 버전의 범위", title: "당신이 정합니다", body: "가장 중요한 부분부터 시작합니다." }, { time: "누구의 작품인가", title: "당신의 것으로 남습니다", body: "이건 당신이 만든 게임입니다." }] },
    vision: { eyebrow: "우리가 믿는 것", title: ["누구나 아이디어를", "자신의"], emphasis: "게임으로 만들 수 있어야 합니다.", body: ["먼저 프로그래머나 아티스트, 개발자가 될 필요는 없습니다. 플레이어에게 어떤 감정을 주고 싶은지 안다면 시작할 수 있습니다.", "Bee Game Studio는 더 많은 사람이 “아이디어가 있어요”에서 “이건 내가 만든 게임이에요”로 나아가도록 돕습니다."] },
    waitlist: { title: ["당신의 첫 게임은", "어떤 말에서 시작될까요?"], body: "Bee Game Studio는 출시를 준비하고 있습니다. 얼리 액세스를 신청하고, 아이디어를 게임으로 만드는 첫 창작자 중 한 명이 되어 보세요.", name: "이름", email: "이메일", persona: "당신과 가장 가까운 항목", personas: { idea: "게임 아이디어가 있습니다", creator: "인디 게임 창작자입니다", investor: "투자자 또는 파트너입니다" }, submit: "얼리 액세스 신청", submitting: "신청 중…", successTitle: "얼리 액세스 목록에 등록되었습니다", duplicateTitle: "이미 목록에 등록되어 있습니다", errorTitle: "이번에는 신청되지 않았습니다", success: "신청되었습니다. 얼리 액세스가 시작되면 알려 드리겠습니다.", duplicate: "이미 얼리 액세스를 신청한 이메일입니다.", error: "지금은 신청할 수 없습니다. 잠시 후 다시 시도해 주세요.", close: "닫기", privacy: "Bee Game Studio와 얼리 액세스 초대에 관한 소식만 보내 드립니다." },
  },
};
