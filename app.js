// app.js
App({
  onLaunch() {
    // 检查设备信息
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.statusBarHeight = systemInfo.statusBarHeight;
    this.globalData.screenHeight = systemInfo.screenHeight;
    this.globalData.screenWidth = systemInfo.screenWidth;
  },

  globalData: {
    statusBarHeight: 0,
    screenHeight: 0,
    screenWidth: 0
  }
})
