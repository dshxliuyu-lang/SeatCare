const DIM_ORDER = ['结构体征', '疼痛不适', '生活习惯', '运动核心']

const AGES = ['18岁以下', '19–35岁', '36–50岁', '50岁以上']
const GENDERS = ['男', '女']
const ROLES = ['学生', '久坐办公', '体力劳动', '其他']

const qs = [
  ['结构体征', '照镜子时，你是否发现左右肩膀明显不等高？', ['没有', '偶尔或轻微', '经常或明显']],
  ['疼痛不适', '久坐或久站后，你是否容易腰酸或腰部僵硬？', ['很少或没有', '偶尔', '经常']],
  ['结构体征', '自然站立时，你是否有含胸、驼背或头部前伸？', ['没有', '轻微', '明显']],
  ['结构体征', '你的骨盆或裤腰线看起来是否左右不平？', ['没有', '不确定或轻微', '明显']],
  ['疼痛不适', '低头使用手机或电脑后，颈肩是否酸胀？', ['很少或没有', '偶尔', '经常']],
  ['结构体征', '你是否感觉一侧鞋底磨损比另一侧明显？', ['没有', '有一点', '很明显']],
  ['结构体征', '向前弯腰时，背部两侧高度是否看起来不同？', ['没有', '不确定或轻微', '明显']],
  ['疼痛不适', '过去一个月，颈背腰部不适是否影响睡眠或活动？', ['没有', '偶尔', '经常']],
  ['生活习惯', '你每天连续坐着超过1小时而不活动的次数多吗？', ['很少', '有时', '很多']],
  ['运动核心', '规律进行核心、背部或拉伸运动的情况是？', ['每周3次以上', '每周1–2次', '几乎不运动']]
].map((x, i) => ({ id: i, dim: x[0], title: x[1], options: x[2] }))

Page({
  data: {
    stage: 'profile',
    profile: { age: '', gender: '', role: '' },
    ages: AGES,
    genders: GENDERS,
    roles: ROLES,
    questions: qs,
    current: 0,
    answers: {},
    selected: -1,
    dimLabel: qs[0].dim
  },

  onLoad() {
    const p = wx.getStorageSync('spineProfile')
    if (p) this.setData({ profile: p })
    const d = wx.getStorageSync('spineDraft')
    if (d && d.answers) {
      const c = d.current || 0
      this.setData({ stage: 'quiz', answers: d.answers, current: c, selected: d.answers[c] ?? -1, dimLabel: qs[c].dim })
    }
  },

  setAge(e) { this.setData({ 'profile.age': e.currentTarget.dataset.v }) },
  setGender(e) { this.setData({ 'profile.gender': e.currentTarget.dataset.v }) },
  setRole(e) { this.setData({ 'profile.role': e.currentTarget.dataset.v }) },

  startQuiz() {
    const p = this.data.profile
    if (!p.age || !p.gender || !p.role) {
      wx.showToast({ title: '请先选择基本信息', icon: 'none' })
      return
    }
    wx.setStorageSync('spineProfile', p)
    this.setData({ stage: 'quiz' })
  },

  choose(e) {
    const v = Number(e.currentTarget.dataset.value)
    const a = { ...this.data.answers, [this.data.current]: v }
    this.setData({ answers: a, selected: v })
    wx.setStorageSync('spineDraft', { answers: a, current: this.data.current })
  },

  prev() {
    const c = this.data.current - 1
    if (c >= 0) this.setData({ current: c, selected: this.data.answers[c] ?? -1, dimLabel: qs[c].dim })
  },

  next() {
    if (this.data.selected < 0) {
      wx.showToast({ title: '请选择一个答案', icon: 'none' })
      return
    }
    if (this.data.current < qs.length - 1) {
      const c = this.data.current + 1
      this.setData({ current: c, selected: this.data.answers[c] ?? -1, dimLabel: qs[c].dim })
      return
    }
    const a = this.data.answers
    const score = Object.values(a).reduce((s, v) => s + Number(v), 0)
    const dims = {}
    DIM_ORDER.forEach((d) => { dims[d] = { score: 0, max: 0 } })
    qs.forEach((q, i) => {
      if (a[i] !== undefined) {
        dims[q.dim].score += Number(a[i])
        dims[q.dim].max += 2
      }
    })
    const r = { score, dims, profile: this.data.profile, completedAt: Date.now() }
    getApp().globalData.latestResult = r
    wx.setStorageSync('spineResult', r)
    wx.removeStorageSync('spineDraft')
    wx.redirectTo({ url: '/pages/result/result' })
  }
})
