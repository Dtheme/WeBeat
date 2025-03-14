Component({
  options: {
    multipleSlots: true // 在组件定义时的选项中启用多slot支持
  },
  /**
   * 组件的属性列表
   */
  properties: {
    extClass: {
      type: String,
      value: ''
    },
    title: {
      type: String,
      value: ''
    },
    background: {
      type: String,
      value: ''
    },
    color: {
      type: String,
      value: ''
    },
    back: {
      type: Boolean,
      value: true
    },
    loading: {
      type: Boolean,
      value: false
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    animated: {
      // 显示隐藏的时候opacity动画效果
      type: Boolean,
      value: true
    },
    show: {
      // 显示隐藏导航，隐藏的时候navigation-bar的高度占位还在
      type: Boolean,
      value: true,
      observer: '_showChange'
    },
    // back为true的时候，返回的页面深度
    delta: {
      type: Number,
      value: 1
    },
  },
  /**
   * 组件的初始数据
   */
  data: {
    displayStyle: ''
  },
  lifetimes: {
    attached() {
      try {
        // 使用新API获取胶囊按钮位置
        const rect = wx.getMenuButtonBoundingClientRect();
        
        // 使用新API获取窗口信息和设备信息
        const windowInfo = wx.getWindowInfo();
        const deviceInfo = wx.getDeviceInfo();
        const appBaseInfo = wx.getAppBaseInfo();
        
        const isAndroid = appBaseInfo.platform === 'android';
        const isDevtools = appBaseInfo.platform === 'devtools';
        
        this.setData({
          ios: !isAndroid,
          innerPaddingRight: `padding-right: ${windowInfo.windowWidth - rect.left}px`,
          leftWidth: `width: ${windowInfo.windowWidth - rect.left}px`,
          safeAreaTop: isDevtools || isAndroid ? 
            `height: calc(var(--height) + ${windowInfo.safeArea.top}px); padding-top: ${windowInfo.safeArea.top}px` : 
            ``
        });
      } catch (error) {
        console.error('[NavigationBar] 获取设备信息失败:', error);
        
        // 降级处理：使用旧API
        const rect = wx.getMenuButtonBoundingClientRect();
        wx.getSystemInfo({
          success: (res) => {
            const isAndroid = res.platform === 'android';
            const isDevtools = res.platform === 'devtools';
            this.setData({
              ios: !isAndroid,
              innerPaddingRight: `padding-right: ${res.windowWidth - rect.left}px`,
              leftWidth: `width: ${res.windowWidth - rect.left}px`,
              safeAreaTop: isDevtools || isAndroid ? 
                `height: calc(var(--height) + ${res.safeArea.top}px); padding-top: ${res.safeArea.top}px` : 
                ``
            });
          }
        });
      }
    },
  },
  /**
   * 组件的方法列表
   */
  methods: {
    _showChange(show) {
      const animated = this.data.animated
      let displayStyle = ''
      if (animated) {
        displayStyle = `opacity: ${
          show ? '1' : '0'
        };transition:opacity 0.5s;`
      } else {
        displayStyle = `display: ${show ? '' : 'none'}`
      }
      this.setData({
        displayStyle
      })
    },
    back() {
      const data = this.data
      if (data.delta) {
        wx.navigateBack({
          delta: data.delta
        })
      }
      this.triggerEvent('back', { delta: data.delta }, {})
    }
  },
})
