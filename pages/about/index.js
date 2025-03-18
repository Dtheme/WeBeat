Page({
  data: {
    version: '1.0.0',
    year: new Date().getFullYear()
  },

  onLoad() {
    // 获取应用版本号
    const accountInfo = wx.getAccountInfoSync();
    if (accountInfo && accountInfo.miniProgram) {
      this.setData({
        version: accountInfo.miniProgram.version || '1.0.0'
      });
    }
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

  onBackTap() {
    // 添加触感反馈
    wx.vibrateShort({
      type: 'light'
    });
    
    // 返回上一页
    wx.navigateBack({
      delta: 1,
      fail: () => {
        // 如果返回失败（没有上一页），则跳转到首页
        wx.switchTab({
          url: '/pages/metronome/index'
        });
      }
    });
  },

  onIconTap() {
    wx.vibrateShort({
      type: 'light'
    });
  },

  onEmailTap() {
    wx.vibrateShort({
      type: 'light'
    });
    
    wx.setClipboardData({
      data: 'wecopilot.alpha@gmail.com',
      success: () => {
        wx.showToast({
          title: '邮箱地址已复制',
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