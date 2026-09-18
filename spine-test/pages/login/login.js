Page({
  data: { busy: false },

  onLoad() {
    if (getApp().isLoggedIn()) {
      wx.navigateBack()
    }
  },

  login() {
    if (this.data.busy) return
    this.setData({ busy: true })
    wx.login({
      success: ({ code }) => {
        const app = getApp()
        wx.request({
          url: `${app.globalData.aiServiceUrl}/auth/login`,
          method: 'POST',
          data: { code, deviceId: app.ensureDeviceId() },
          success: (res) => {
            if (res.statusCode === 200 && res.data.openid) {
              app.setUser(res.data.openid, res.data.nickname)
              this.fetchMember(res.data.openid)
              wx.showToast({ title: '登录成功', icon: 'success' })
              setTimeout(() => wx.navigateBack(), 600)
            } else {
              this.fail((res.data && res.data.error) || '登录失败')
            }
          },
          fail: () => this.fail('无法连接服务，请先启动后端 ai-service'),
          complete: () => this.setData({ busy: false })
        })
      },
      fail: () => this.fail('微信登录失败，请重试')
    })
  },

  fetchMember(openid) {
    const app = getApp()
    wx.request({
      url: `${app.globalData.aiServiceUrl}/member/status?openid=${openid}`,
      success: (res) => {
        if (res.statusCode === 200) app.setMember(!!res.data.member)
      }
    })
  },

  fail(msg) {
    this.setData({ busy: false })
    wx.showToast({ title: msg, icon: 'none', duration: 3000 })
  }
})
