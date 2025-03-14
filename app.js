// app.js
App({
  onLaunch() {
    // 检查设备信息 - 使用新API替代wx.getSystemInfoSync
    try {
      const windowInfo = wx.getWindowInfo();
      const deviceInfo = wx.getDeviceInfo();
      const appBaseInfo = wx.getAppBaseInfo();
      
      this.globalData.statusBarHeight = windowInfo.statusBarHeight || 0;
      this.globalData.screenHeight = windowInfo.screenHeight || 0;
      this.globalData.screenWidth = windowInfo.screenWidth || 0;
      this.globalData.platform = deviceInfo.platform || '';
      this.globalData.brand = deviceInfo.brand || '';
      this.globalData.model = deviceInfo.model || '';
      this.globalData.system = deviceInfo.system || '';
      
      console.log('[App] 设备信息:', this.globalData);
    } catch (error) {
      console.error('[App] 获取设备信息失败:', error);
      
      // 降级处理：使用旧API
      try {
        const systemInfo = wx.getSystemInfoSync();
        this.globalData.statusBarHeight = systemInfo.statusBarHeight;
        this.globalData.screenHeight = systemInfo.screenHeight;
        this.globalData.screenWidth = systemInfo.screenWidth;
      } catch (fallbackError) {
        console.error('[App] 降级获取设备信息也失败:', fallbackError);
      }
    }
  },

  globalData: {
    statusBarHeight: 0,
    screenHeight: 0,
    screenWidth: 0,
    platform: '',
    brand: '',
    model: '',
    system: ''
  }
})
