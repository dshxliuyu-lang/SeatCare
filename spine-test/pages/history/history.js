const LEVEL_TEXT = { ideal: '优秀', good: '良好', warning: '注意', danger: '警示' }

Page({
  data: {
    records: [],
    empty: false,
    loading: false,
    compareMode: false,
    selected: [],
    detail: null,
    compare: null
  },

  onShow() {
    if (!getApp().isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }
    this.load()
  },

  load() {
    this.setData({ loading: true })
    const base = getApp().globalData.aiServiceUrl
    wx.request({
      url: `${base}/records?openid=${getApp().globalData.openid}`,
      success: (res) => {
        if (res.statusCode === 200) {
          const records = (res.data || []).map((r) => this.decorate(r))
          this.setData({ records, empty: records.length === 0 })
        }
      },
      fail: () => wx.showToast({ title: '无法连接服务', icon: 'none' }),
      complete: () => this.setData({ loading: false })
    })
  },

  decorate(r) {
    return {
      id: r.id,
      angle: r.angle,
      shoulderTilt: r.shoulder_tilt,
      headTilt: r.head_tilt,
      lateralLean: r.lateral_lean,
      level: r.level,
      postureType: r.posture_type,
      levelText: LEVEL_TEXT[r.level] || r.level,
      thumbSrc: r.thumb ? 'data:image/jpeg;base64,' + r.thumb : '',
      createdAt: r.created_at,
      date: this.fmt(r.created_at)
    }
  },

  fmt(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  noop() {},

  toggleCompare() {
    this.setData({
      compareMode: !this.data.compareMode,
      selected: [],
      detail: null,
      compare: null
    })
  },

  onSelect(e) {
    const id = Number(e.currentTarget.dataset.id)
    let selected = this.data.selected.slice()
    if (selected.indexOf(id) >= 0) {
      selected = selected.filter((x) => x !== id)
    } else if (selected.length < 2) {
      selected.push(id)
    } else {
      wx.showToast({ title: '最多选择 2 条', icon: 'none' })
      return
    }
    this.setData({ selected })
  },

  openDetail(e) {
    if (this.data.compareMode) {
      this.onSelect(e)
      return
    }
    this.fetchDetail(e.currentTarget.dataset.id, (detail) => this.setData({ detail }))
  },

  doCompare() {
    if (this.data.selected.length !== 2) {
      wx.showToast({ title: '请选择 2 条记录', icon: 'none' })
      return
    }
    const ids = this.data.selected.slice()
    this.fetchDetail(ids[0], (a) => {
      this.fetchDetail(ids[1], (b) => {
        const left = a.created_at <= b.created_at ? a : b
        const right = a.created_at <= b.created_at ? b : a
        const delta = Math.round((right.angle - left.angle) * 10) / 10
        const verdict = delta < 0 ? '头前伸角度较之前减小，坐姿有改善'
          : delta > 0 ? '头前伸角度较之前增大，需继续调整'
          : '头前伸角度与之前接近'
        this.setData({ compare: { left, right, delta, verdict } })
      })
    })
  },

  fetchDetail(id, cb) {
    const base = getApp().globalData.aiServiceUrl
    wx.request({
      url: `${base}/records/${id}`,
      success: (res) => {
        if (res.statusCode === 200) {
          const d = res.data
          const r = {
            id: d.id,
            angle: d.angle,
            shoulderTilt: d.shoulder_tilt,
            headTilt: d.head_tilt,
            lateralLean: d.lateral_lean,
            level: d.level,
            postureType: d.posture_type,
            status: d.status,
            advice: d.advice,
            levelText: LEVEL_TEXT[d.level] || d.level,
            createdAt: d.created_at,
            date: this.fmt(d.created_at),
            imageSrc: getApp().saveImage(`rec-${id}.jpg`, d.analyzed_image),
            originalSrc: getApp().saveImage(`rec-${id}-orig.jpg`, d.original_image),
            standardSrc: getApp().saveImage(`rec-${id}-std.jpg`, d.standard_image)
          }
          cb(r)
        }
      }
    })
  },

  closePanel() {
    this.setData({ detail: null, compare: null })
  },

  remove(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条坐姿记录吗？',
      success: (r) => {
        if (!r.confirm) return
        wx.request({
          url: `${getApp().globalData.aiServiceUrl}/records/${id}`,
          method: 'DELETE',
          success: () => {
            this.setData({ detail: null, compare: null })
            this.load()
          }
        })
      }
    })
  }
})
