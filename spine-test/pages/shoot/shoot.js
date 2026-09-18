Page({
  data: {
    step: 1,      // 1=正面照, 2=侧面照
    front: '',
    side: '',
    tilted: false,
    showPrivacy: false
  },

  onLoad() {
    this.startTilt()
    this.checkPrivacy()
  },

  onUnload() {
    this.stopTilt()
  },

  startTilt() {
    try {
      wx.startDeviceMotionListening({ interval: 'normal' })
      wx.onDeviceMotionChange((res) => {
        this.setData({ tilted: Math.abs(res.gamma || 0) > 6 })
      })
    } catch (e) {
      // 模拟器 / 无传感器时忽略
    }
  },

  stopTilt() {
    try {
      wx.offDeviceMotionChange()
      wx.stopDeviceMotionListening()
    } catch (e) {}
  },

  checkPrivacy() {
    if (!wx.getPrivacySetting) return
    wx.getPrivacySetting({
      success: (res) => {
        if (res.needAuthorization) {
          this.setData({ showPrivacy: true })
        }
      }
    })
  },

  onAgreePrivacy() {
    this.setData({ showPrivacy: false })
    wx.showToast({ title: '已同意，请再次点击拍摄', icon: 'none' })
  },

  onRefusePrivacy() {
    this.setData({ showPrivacy: false })
    wx.showToast({ title: '需同意隐私协议才能使用拍摄', icon: 'none' })
  },

  takePhoto() {
    if (this.data.showPrivacy) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' })
      return
    }
    if (this.data.tilted) {
      wx.showToast({ title: '手机有点歪，请摆正再拍', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      camera: 'back',
      success: ({ tempFiles }) => {
        const p = tempFiles[0] && tempFiles[0].tempFilePath
        if (p) this.next(p)
      },
      fail: (err) => {
        console.error('chooseMedia 相机失败:', err)
        wx.showToast({ title: '相机打开失败，请检查系统相机权限或用「相册」选择', icon: 'none' })
      }
    })
  },

  chooseAlbum() {
    if (this.data.showPrivacy) {
      wx.showToast({ title: '请先同意隐私协议', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      success: ({ tempFiles }) => {
        const p = tempFiles[0] && tempFiles[0].tempFilePath
        if (p) this.next(p)
      }
    })
  },

  next(path) {
    if (this.data.step === 1) {
      this.setData({ front: path, step: 2 })
    } else {
      this.setData({ side: path })
      getApp().globalData.shootResult = { front: this.data.front, side: path }
      wx.navigateBack()
    }
  },

  prev() {
    if (this.data.step === 2) {
      this.setData({ step: 1 })
    }
  }
})
