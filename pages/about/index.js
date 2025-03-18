Page({
  data: {
    version: '1.0.0',
    year: new Date().getFullYear()
  },

  onLoad(options) {
    this.getVersion();
  },

  onShow() {
    // 页面显示时的逻辑
  },

  onHide() {
    // 页面隐藏时的逻辑
  },

  onUnload() {
    // 页面卸载时的逻辑
  },

  getVersion() {
    try {
      const accountInfo = wx.getAccountInfoSync();
      if (accountInfo && accountInfo.miniProgram) {
        this.setData({
          version: accountInfo.miniProgram.version || '1.0.0'
        });
      }
    } catch (error) {
      console.error('获取版本号失败:', error);
    }
  },

  onBackTap() {
    wx.vibrateShort({ type: 'light' });
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.reLaunch({
          url: '/pages/metronome/index'
        });
      }
    });
  },

  onIconTap() {
    wx.vibrateShort({ type: 'light' });
    // 可以添加图标点击效果，比如放大动画
  },

  onGithubTap() {
    wx.vibrateShort({ type: 'light' });
    wx.setClipboardData({
      data: 'github.com/dzw',
      success: () => {
        wx.showToast({
          title: 'GitHub 地址已复制',
          icon: 'none'
        });
      }
    });
  },

  onShareAppMessage() {
    return {
      title: 'DamnBeat - 专业的节拍器应用',
      path: '/pages/metronome/index'
    };
  },

  onShareTimeline() {
    return {
      title: 'DamnBeat - 专业的节拍器应用'
    };
  }
});