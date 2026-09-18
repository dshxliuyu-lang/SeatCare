App({
  globalData: {
    latestResult: null,
    aiServiceUrl: 'http://127.0.0.1:5000',
    openid: '',
    nickname: '',
    member: false
  },

  onLaunch() {
    this.globalData.openid = wx.getStorageSync('openid') || ''
    this.globalData.nickname = wx.getStorageSync('nickname') || ''
    this.globalData.member = !!wx.getStorageSync('member')
  },

  isLoggedIn() {
    return !!this.globalData.openid
  },

  isMember() {
    return !!this.globalData.member
  },

  setMember(member) {
    this.globalData.member = !!member
    wx.setStorageSync('member', !!member)
  },

  setUser(openid, nickname) {
    this.globalData.openid = openid
    this.globalData.nickname = nickname
    wx.setStorageSync('openid', openid)
    wx.setStorageSync('nickname', nickname)
  },

  ensureDeviceId() {
    let id = wx.getStorageSync('deviceId')
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      wx.setStorageSync('deviceId', id)
    }
    return id
  },

  // 把 base64 图片写到本地文件，返回可被 <image src> 使用的路径
  saveImage(name, base64) {
    if (!base64) return ''
    const path = `${wx.env.USER_DATA_PATH}/${name}`
    try {
      wx.getFileSystemManager().writeFileSync(path, base64, 'base64')
      return path
    } catch (e) {
      return ''
    }
  }
})
