Page({
  data: {
    step: 1,      // 1=正面照, 2=侧面照
    front: '',
    side: '',
    tilted: false
  },

  onLoad() {
    this.startTilt()
  },

  onUnload() {
    this.stopTilt()
  },

  startTilt() {
    try {
      wx.startDeviceMotionListening({ interval: 'normal' })
      wx.onDeviceMotionChange((res) => {
        // gamma 为左右倾斜角度，超 6° 提示摆正
        this.setData({ tilted: Math.abs(res.gamma || 0) > 6 })
      })
    } catch (e) {
      // 模拟器 / 无传感器时忽略倾斜检测
    }
  },

  stopTilt() {
    try {
      wx.offDeviceMotionChange()
      wx.stopDeviceMotionListening()
    } catch (e) {}
  },

  takePhoto() {
    if (this.data.tilted) {
      wx.showToast({ title: '手机有点歪，请摆正再拍', icon: 'none' })
      return
    }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera'],
      camera: 'back',
      success: ({ tempFiles }) => {
        const p = tempFiles[0] && tempFiles[0].tempFilePath
        if (p) this.next(p)
      },
      fail: () => wx.showToast({ title: '相机打开失败，请用「相册」选择', icon: 'none' })
    })
  },

  chooseAlbum() {
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
