Page({
  data: {
    loggedIn: false,
    nickname: '',
    openidShort: '',
    member: false
  },

  onShow() {
    const app = getApp()
    this.setData({
      loggedIn: app.isLoggedIn(),
      nickname: app.globalData.nickname || '',
      openidShort: app.globalData.openid ? app.globalData.openid.slice(-6) : '',
      member: app.isMember()
    })
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
  }
})
