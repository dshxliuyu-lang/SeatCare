const DIM_ORDER = ['结构体征', '疼痛不适', '生活习惯', '运动核心']

const DIM_ADVICE = {
  结构体征: {
    low: '未发现明显的体态不对称信号。',
    mid: '存在轻微体态不对称，建议定期观察、保持对称发力。',
    high: '体态不对称信号较明显，若持续请到正规医院相关科室评估。'
  },
  疼痛不适: {
    low: '未发现明显的疼痛不适信号。',
    mid: '偶有颈腰不适，注意姿势，避免长时间固定一个姿势。',
    high: '不适较频繁且可能影响生活，建议就医并记录诱因。'
  },
  生活习惯: {
    low: '久坐习惯尚可，继续保持。',
    mid: '久坐时间偏长，建议每 40–60 分钟起身活动。',
    high: '久坐较多，建议设置提醒并主动增加活动。'
  },
  运动核心: {
    low: '运动习惯良好，继续保持。',
    mid: '运动频率偏低，建议增加核心与拉伸训练。',
    high: '几乎不运动，建议从温和的核心与拉伸逐步开始。'
  }
}

const RED_FLAGS = [
  '大小便失禁或排尿困难',
  '会阴 / 鞍区麻木',
  '进行性下肢无力或行走困难',
  '夜间或静息时持续疼痛',
  '伴发热或不明原因体重下降',
  '近期有摔倒或外伤史',
  '已确诊骨质疏松'
]

Page({
  data: {
    score: 0,
    level: '',
    tone: '',
    summary: '',
    tips: [],
    dims: [],
    profileText: '',
    profileNote: '',
    posture: null,
    combined: '',
    redFlags: RED_FLAGS.map((t) => ({ text: t, on: false })),
    anyFlag: false
  },

  onLoad() {
    const r = getApp().globalData.latestResult || wx.getStorageSync('spineResult')
    if (!r || typeof r.score !== 'number') {
      wx.redirectTo({ url: '/pages/test/test' })
      return
    }
    let x
    if (r.score <= 6) {
      x = ['低风险', 'low', '目前未发现较明显的风险信号，请继续保持良好习惯。', [
        '保持屏幕与视线高度合适，双脚自然踩地',
        '每坐 40–60 分钟起身活动 3–5 分钟',
        '每周安排 3 次温和的核心与背部训练'
      ]]
    } else if (r.score <= 13) {
      x = ['中等风险', 'mid', '存在一些值得留意的姿态或不适信号，建议主动调整并持续观察。', [
        '减少长时间保持同一姿势，设置活动提醒',
        '从无痛范围内的颈肩、胸背和髋部拉伸开始',
        '记录不适诱因，若持续或加重请就医'
      ]]
    } else {
      x = ['高风险', 'high', '多项表现提示风险较高，建议重视身体信号并寻求专业评估。', [
        '避免自行大幅扳动、强力牵拉或负重训练',
        '尽快前往正规医院相关科室咨询',
        '若出现麻木无力、大小便异常或剧烈疼痛，请及时就医'
      ]]
    }
    const extra = this.profileExtras(r.profile)
    const profileText = r.profile && r.profile.age ? `${r.profile.age} · ${r.profile.role}` : ''
    const posture = getApp().globalData.latestPosture || wx.getStorageSync('latestPosture')
    const postureView = posture ? {
      type: posture.type,
      level: posture.level,
      angle: posture.angle,
      levelText: ({ ideal: '优秀', good: '良好', warning: '注意', danger: '警示' })[posture.level] || posture.level
    } : null
    this.setData({
      score: r.score,
      level: x[0],
      tone: x[1],
      summary: x[2],
      tips: x[3].concat(extra.extras),
      dims: this.buildDims(r.dims),
      profileText,
      profileNote: extra.note,
      posture: postureView,
      combined: this.combineAssessment(x[0], postureView)
    })
  },

  combineAssessment(scoreLevel, posture) {
    if (!posture) return ''
    if (posture.type === '标准') {
      return `问卷为${scoreLevel}，坐姿检测未发现明显异常，继续保持。`
    }
    const sev = { ideal: '轻微', good: '轻微', warning: '存在', danger: '较明显' }[posture.level] || '存在'
    return `问卷为${scoreLevel}，坐姿检测${sev}「${posture.type}」，建议结合下方建议一起调整。`
  },

  profileExtras(profile) {
    const extras = []
    let note = ''
    if (!profile) return { note, extras }
    const { age, gender, role } = profile

    if (age === '18岁以下') {
      note = '你正处在长身体的阶段，肩膀高低、弯腰不对称这些小信号，值得多留一份心'
      extras.push('发现肩高或弯腰明显不对称时，让家长陪着去正规医院排查一下，多数只是体态问题，别太担心')
    } else if (age === '19–35岁') {
      note = '这个年纪身体恢复力好，趁现在养成好习惯最划算'
      extras.push('现在开始规律活动，比以后再补救要轻松得多')
    } else if (age === '36–50岁') {
      note = '这个阶段要多留意日积月累的劳损信号，别硬扛'
      extras.push('工作再忙，也给自己设个起身提醒，让腰背喘口气')
    } else {
      note = '年纪渐长，骨骼和关节更需要被细心照顾'
      extras.push('起身、转身动作放慢一点，避免突然发力或负重')
    }

    if (gender === '女') {
      extras.push('女性进入中老年后骨量流失更快，记得补钙，并保持快走、散步这类负重运动')
    } else {
      extras.push('男性常见的腰背问题多来自久坐和搬重物，练好核心力量更省腰')
    }

    if (role === '久坐办公') {
      extras.push('工位调好：屏幕与视线齐平、腰背有靠、双脚踩地，酸胀会少一大半')
    } else if (role === '体力劳动') {
      extras.push('搬东西记住口诀：屈膝下蹲、腰背挺直、用腿发力，别弯腰硬提')
    } else if (role === '学生') {
      extras.push('书包别背太重，尽量双肩背，课间起来走两步')
    }

    return { note, extras }
  },

  buildDims(dims) {
    if (!dims) return []
    return DIM_ORDER.map((name) => {
      const d = dims[name] || { score: 0, max: 0 }
      const pct = d.max ? d.score / d.max : 0
      let tone, advice
      if (pct < 0.34) { tone = 'low'; advice = DIM_ADVICE[name].low }
      else if (pct < 0.67) { tone = 'mid'; advice = DIM_ADVICE[name].mid }
      else { tone = 'high'; advice = DIM_ADVICE[name].high }
      return { name, score: d.score, max: d.max, pct: Math.round(pct * 100), tone, advice }
    })
  },

  toggleFlag(e) {
    const i = Number(e.currentTarget.dataset.index)
    const redFlags = this.data.redFlags.slice()
    redFlags[i] = { ...redFlags[i], on: !redFlags[i].on }
    this.setData({ redFlags, anyFlag: redFlags.some((f) => f.on) })
  },

  again() {
    wx.redirectTo({ url: '/pages/test/test' })
  },

  knowledge() {
    wx.switchTab({ url: '/pages/knowledge/knowledge' })
  }
})
