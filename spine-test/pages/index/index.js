// 每种坏体态对应的矫正训练参考（B 站视频，非正骨；仅供科普）
const POSTURE_VIDEOS = {
  头前伸: { title: '20MIN 头不前伸｜矫正头前伸+改善颈肩圆背', author: 'YogaLadyM流瑜伽', url: 'https://www.bilibili.com/video/BV1NStszPEHj/' },
  高低肩: { title: '功能性脊柱侧弯+高低肩根本性纠正方法', author: 'B站康复UP主', url: 'https://www.bilibili.com/video/BV15CUQBREMd/' },
  头侧倾: { title: '低头族自救！10MIN 脖子回正训练', author: 'B站运动康复UP主', url: 'https://www.bilibili.com/video/BV1y9c5ziERx/' },
  侧偏: { title: '23度脊柱侧弯康复训练「脊柱拉伸」', author: 'B站康复UP主', url: 'https://www.bilibili.com/video/BV1Jmk2Y1ELU/' },
  后仰: { title: '10分钟体态矫正｜改善驼背圆肩（全程坐姿）', author: 'B站体态UP主', url: 'https://www.bilibili.com/video/BV1aGpwzaEJ6/' }
}

Page({
  data: {
    sourceImage: '',
    sideImage: '',
    video: null,
    analyzedImage: '',
    standardImage: '',
    blurredImage: '',
    loggedIn: false,
    reminder: { running: false, remain: 0, totalSeconds: 1800, hour: 0, minute: 30, remainText: '0:00' },
    reminderRange: [
      ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
      ['0', '5', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']
    ],
    reminderValue: [0, 6],
    demo: {
      running: false,
      locked: false,
      level: 'idle',
      type: '标准',
      status: '等待开始演示',
      angle: '0.0°',
      shoulder: '0.0°',
      head: '0.0°',
      advice: '点击“开始演示”，查看坐姿检测系统的状态变化。',
      analysisId: '',
      price: 9.9
    },
    tips: [
      { title: '调整坐姿', icon: '坐', color: 'green', content: '双脚平放，屏幕上缘接近视线水平。' },
      { title: '定时活动', icon: '动', color: 'orange', content: '每坐 40–60 分钟，起身舒展几分钟。' }
    ]
  },

  onShow() {
    const totalSeconds = wx.getStorageSync('reminderTotal') || 1800
    const hour = Math.floor(totalSeconds / 3600)
    const minute = Math.round((totalSeconds % 3600) / 60)
    this.setData({
      loggedIn: getApp().isLoggedIn(),
      'reminder.totalSeconds': totalSeconds,
      'reminder.hour': hour,
      'reminder.minute': minute,
      reminderValue: [Math.min(hour, 12), Math.round(minute / 5)]
    })
    if (this.data.reminder.running && this.data.reminder.remain <= 0) {
      this.setRemain(totalSeconds)
    }
    this.loadTips()
    this.applyShootResult()
    this.restoreLocked()
    this.refreshMember()
  },

  applyShootResult() {
    const shoot = getApp().globalData.shootResult
    if (!shoot || !shoot.front) return
    getApp().globalData.shootResult = null
    wx.removeStorageSync('lockedDemo')
    this.setData({
      sourceImage: shoot.front,
      sideImage: shoot.side || '',
      analyzedImage: '',
      standardImage: '',
      blurredImage: '',
      video: null,
      demo: {
        running: false, locked: false, level: 'idle', type: '标准',
        status: '照片已就绪，可开始分析', angle: '待分析', shoulder: '--', head: '--',
        advice: '已拍好正/侧面照，点击“AI 分析”生成报告。',
        analysisId: '', price: this.data.demo.price
      }
    })
  },

  refreshMember() {
    const app = getApp()
    if (!app.isLoggedIn()) {
      app.setMember(false)
      return
    }
    wx.request({
      url: `${app.globalData.aiServiceUrl}/member/status?openid=${app.globalData.openid}`,
      success: (res) => {
        if (res.statusCode === 200) {
          const member = !!res.data.member
          app.setMember(member)
          // 会员且本地有未解锁报告：直接自动解锁，无需重拍
          if (member && this.data.demo.locked && this.data.demo.analysisId) {
            this.doUnlock(this.data.demo.analysisId, true)
          }
        }
      }
    })
  },

  restoreLocked() {
    // P1-4：锁定结果落本地，退出重进还能继续解锁，不用重新拍摄
    if (this.data.sourceImage) return
    const locked = wx.getStorageSync('lockedDemo')
    if (!locked || !locked.analysisId) return
    this.setData({
      blurredImage: locked.blurredImage || '',
      video: POSTURE_VIDEOS[locked.type] || null,
      demo: {
        running: false,
        locked: true,
        level: locked.level || 'idle',
        type: locked.type || '标准',
        status: '分析完成 · 结果已锁定',
        angle: locked.angle || '_°',
        shoulder: '--',
        head: '--',
        advice: locked.advice || '',
        analysisId: locked.analysisId,
        price: locked.price || 9.9
      }
    })
  },

  loadTips() {
    wx.request({
      url: `${getApp().globalData.aiServiceUrl}/tips`,
      success: (res) => {
        if (res.statusCode === 200 && res.data.tips && res.data.tips.length) {
          this.setData({ tips: res.data.tips })
        }
      }
    })
  },

  copyVideoLink() {
    if (!this.data.video) return
    wx.setClipboardData({
      data: this.data.video.url,
      success: () => wx.showToast({ title: '链接已复制，去 B 站打开', icon: 'none' })
    })
  },

  saveLatestPosture(result) {
    const angle = result.angle !== undefined
      ? `${Number(result.angle).toFixed(1)}°`
      : (result.maskedAngle || '')
    const p = { type: result.postureType || '标准', level: result.level || 'ideal', angle }
    getApp().globalData.latestPosture = p
    wx.setStorageSync('latestPosture', p)
  },

  onHide() {
    this.clearDemoTimer()
    if (this.data.demo.running) {
      this.setData({ 'demo.running': false })
    }
  },

  onUnload() {
    this.clearDemoTimer()
    this.clearReminderTimer()
  },

  goShoot() {
    if (wx.getStorageSync('privacyAgreed')) {
      wx.navigateTo({ url: '/pages/shoot/shoot' })
      return
    }
    wx.showModal({
      title: '隐私说明',
      content: '照片仅用于本次体态分析，可在「历史记录」里随时删除，不用于其他任何用途。',
      confirmText: '同意并拍摄',
      cancelText: '取消',
      success: (r) => {
        if (r.confirm) {
          wx.setStorageSync('privacyAgreed', true)
          wx.navigateTo({ url: '/pages/shoot/shoot' })
        }
      }
    })
  },

  start() {
    wx.navigateTo({ url: '/pages/test/test' })
  },

  knowledge() {
    wx.switchTab({ url: '/pages/knowledge/knowledge' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  goHistory() {
    if (!getApp().isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }
    wx.navigateTo({ url: '/pages/history/history' })
  },

  startDemo() {
    if (this.data.demo.running || !this.data.sourceImage) return

    // P1-6：分阶段进度——上传中 → 分析中 → 生成报告
    this.setData({
      demo: {
        running: true,
        locked: false,
        level: 'idle',
        type: '标准',
        status: '上传中…',
        angle: '分析中',
        shoulder: '--',
        head: '--',
        advice: '正在上传照片，请稍候。',
        analysisId: '',
        price: this.data.demo.price
      }
    })
    const formData = { openid: getApp().globalData.openid || '' }
    if (this.data.sideImage) {
      try {
        formData.side = wx.getFileSystemManager().readFileSync(this.data.sideImage, 'base64')
      } catch (e) {}
    }
    const task = wx.uploadFile({
      url: `${getApp().globalData.aiServiceUrl}/analyze`,
      filePath: this.data.sourceImage,
      name: 'image',
      formData,
      success: ({ statusCode, data }) => {
        let result
        try { result = JSON.parse(data) } catch (error) { result = {} }
        if (statusCode !== 200) {
          this.analysisFailed(result.error || '分析服务返回异常')
          return
        }
        // 终身会员：直接返回完整报告，无需二次付费
        if (result.member === true || result.angle !== undefined) {
          getApp().setMember(true)
          wx.removeStorageSync('lockedDemo')
          this.setData({ 'demo.status': '生成报告中…', 'demo.advice': '正在生成校正预览与建议。' })
          setTimeout(() => this.applyUnlocked(result), 400)
          return
        }
        // 非会员：锁定结果并落本地，退出重进仍可继续解锁
        const blurredImage = getApp().saveImage('posture-blurred.jpg', result.blurredImage)
        wx.setStorageSync('lockedDemo', {
          analysisId: result.analysisId,
          price: result.price || 9.9,
          level: result.level,
          type: result.postureType || '标准',
          angle: result.maskedAngle || '_°',
          advice: result.teaserAdvice || '',
          blurredImage
        })
        this.setData({
          blurredImage,
          video: POSTURE_VIDEOS[result.postureType] || null,
          demo: {
            running: false,
            locked: true,
            level: result.level,
            type: result.postureType || '标准',
            status: '分析完成 · 结果已锁定',
            angle: result.maskedAngle || '_°',
            shoulder: '--',
            head: '--',
            advice: result.teaserAdvice || '',
            analysisId: result.analysisId,
            price: result.price || 9.9
          }
        })
        this.saveLatestPosture(result)
      },
      fail: () => this.analysisFailed('无法连接 AI 服务，请先启动电脑端服务')
    })
    // 上传进度到 100% 后进入「分析中」阶段
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate((res) => {
        if (res.progress >= 100 && this.data.demo.status === '上传中…') {
          this.setData({ 'demo.status': '分析中…', 'demo.advice': '正在识别关键点并计算坐姿指标。' })
        }
      })
    }
  },

  unlock() {
    if (!getApp().isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' })
      return
    }
    const aid = this.data.demo.analysisId
    if (!aid) return
    wx.showModal({
      title: '开通终身会员',
      content: `一次付费 ¥${this.data.demo.price}，终身免费查看所有完整报告，之后无需再付费`,
      confirmText: '支付并开通',
      success: (r) => {
        if (!r.confirm) return
        this.doUnlock(aid, false)
      }
    })
  },

  doUnlock(aid, silent) {
    if (!silent) wx.showLoading({ title: '支付中…' })
    wx.request({
      url: `${getApp().globalData.aiServiceUrl}/unlock`,
      method: 'POST',
      data: { analysisId: aid, openid: getApp().globalData.openid || '' },
      success: (res) => {
        if (res.statusCode === 200 && res.data.angle !== undefined) {
          getApp().setMember(true)
          wx.removeStorageSync('lockedDemo')
          this.applyUnlocked(res.data)
        } else {
          wx.showToast({ title: (res.data && res.data.error) || '开通失败', icon: 'none' })
        }
      },
      fail: () => wx.showToast({ title: '支付失败，请重试', icon: 'none' }),
      complete: () => wx.hideLoading()
    })
  },

  applyUnlocked(result) {
    const analyzedImage = getApp().saveImage('posture-analyzed.jpg', result.analyzedImage)
    const standardImage = getApp().saveImage('posture-standard.jpg', result.standardImage)
    this.setData({
      analyzedImage,
      standardImage,
      blurredImage: '',
      video: POSTURE_VIDEOS[result.postureType] || null,
      demo: {
        running: false,
        locked: false,
        level: result.level,
        type: result.postureType || '标准',
        status: result.status,
        angle: `${Number(result.angle).toFixed(1)}°`,
        shoulder: `${Number(result.shoulderTilt).toFixed(1)}°`,
        head: `${Number(result.headTilt).toFixed(1)}°`,
        advice: result.advice,
        analysisId: result.analysisId || this.data.demo.analysisId,
        price: 0
      }
    })
    this.saveLatestPosture(result)
    this.saveRecord(result)
    wx.showToast({ title: getApp().isMember() ? '终身会员 · 报告已解锁' : '已解锁', icon: 'success' })
  },

  saveRecord(result) {
    if (!getApp().isLoggedIn()) return
    wx.request({
      url: `${getApp().globalData.aiServiceUrl}/records`,
      method: 'POST',
      data: {
        openid: getApp().globalData.openid,
        angle: result.angle,
        shoulderTilt: result.shoulderTilt,
        headTilt: result.headTilt,
        lateralLean: result.lateralLean,
        level: result.level,
        postureType: result.postureType,
        status: result.status,
        advice: result.advice,
        analyzedImage: result.analyzedImage,
        originalImage: result.originalImage,
        standardImage: result.standardImage,
        createdAt: Date.now()
      },
      success: () => wx.showToast({ title: '已保存到历史记录', icon: 'none' })
    })
  },

  analysisFailed(message) {
    wx.removeStorageSync('lockedDemo')
    this.setData({
      demo: { running: false, locked: false, level: 'idle', type: '标准', status: '分析失败', angle: '--', shoulder: '--', head: '--', advice: message, analysisId: '', price: this.data.demo.price }
    })
    wx.showToast({ title: message, icon: 'none', duration: 3000 })
  },

  stopDemo() {
    this.clearDemoTimer()
    wx.removeStorageSync('lockedDemo')
    this.setData({
      demo: {
        running: false,
        locked: false,
        level: 'idle',
        type: '标准',
        status: '演示已停止',
        angle: '0.0°',
        shoulder: '0.0°',
        head: '0.0°',
        advice: '检测界面已回到待机状态。',
        analysisId: '',
        price: this.data.demo.price
      }
    })
  },

  // —— 久坐提醒 ——
  toggleReminder() {
    if (this.data.reminder.running) {
      this.clearReminderTimer()
      this.setData({ 'reminder.running': false, 'reminder.remain': 0, 'reminder.remainText': '0:00' })
      return
    }
    this.setRemain(this.data.reminder.totalSeconds)
    this.setData({ 'reminder.running': true })
    this.reminderTimer = setInterval(() => this.tick(), 1000)
  },

  tick() {
    let remain = this.data.reminder.remain - 1
    if (remain <= 0) {
      remain = this.data.reminder.totalSeconds
      wx.vibrateLong()
      wx.showToast({ title: '该起身活动啦，顺便调整坐姿', icon: 'none', duration: 3000 })
    }
    this.setRemain(remain)
  },

  setRemain(remain) {
    const h = Math.floor(remain / 3600)
    const m = Math.floor((remain % 3600) / 60)
    const sec = remain % 60
    const p = (n) => (n < 10 ? '0' + n : '' + n)
    const remainText = h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`
    this.setData({ 'reminder.remain': remain, 'reminder.remainText': remainText })
  },

  onReminderDuration(e) {
    const [hi, mi] = e.detail.value
    const hour = Number(this.data.reminderRange[0][hi])
    const minute = Number(this.data.reminderRange[1][mi])
    const totalSeconds = hour * 3600 + minute * 60
    wx.setStorageSync('reminderTotal', totalSeconds)
    this.setData({
      'reminder.hour': hour,
      'reminder.minute': minute,
      'reminder.totalSeconds': totalSeconds,
      reminderValue: [hi, mi]
    })
    if (this.data.reminder.running) {
      this.setRemain(totalSeconds)
    }
  },

  clearReminderTimer() {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer)
      this.reminderTimer = null
    }
  },

  clearDemoTimer() {
    if (this.demoTimer) {
      clearTimeout(this.demoTimer)
      this.demoTimer = null
    }
  }
})
