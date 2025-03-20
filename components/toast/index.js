Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: ''
    },
    icon: {
      type: String,
      value: 'none'  // none, success, error, loading, rhythm, info
    },
    duration: {
      type: Number,
      value: 2000
    }
  },

  data: {
    animationData: {},
    timer: null,
    iconPath: ''
  },

  observers: {
    'show': function(show) {
      if (show) {
        this.showToast();
      }
    },
    'icon': function(icon) {
      let iconPath = '';
      if (icon && icon !== 'none') {
        // 根据不同的图标类型设置不同的 SVG 路径
        switch (icon) {
          case 'success':
            iconPath = '/assets/icons/success.svg';
            break;
          case 'error':
            iconPath = '/assets/icons/error.svg';
            break;
          case 'loading':
            iconPath = '/assets/icons/loading.svg';
            break;
          case 'rhythm':
            iconPath = '/assets/icons/rhythm.svg';
            break;
          case 'info':
            iconPath = '/assets/icons/info.svg';
            break;
        }
      }
      this.setData({ iconPath });
    }
  },

  lifetimes: {
    attached() {
      this.animation = wx.createAnimation({
        duration: 300,
        timingFunction: 'ease'
      });
    },
    detached() {
      if (this.data.timer) {
        clearTimeout(this.data.timer);
      }
    }
  },

  methods: {
    showToast() {
      // 清除可能存在的定时器
      if (this.data.timer) {
        clearTimeout(this.data.timer);
      }

      // 显示动画
      this.animation.translateY(0).opacity(1).step();
      this.setData({
        animationData: this.animation.export()
      });

      // 设置自动隐藏
      const timer = setTimeout(() => {
        this.hideToast();
      }, this.data.duration);

      this.setData({ timer });
    },

    hideToast() {
      this.animation.translateY(-100).opacity(0).step();
      this.setData({
        animationData: this.animation.export()
      });

      // 动画结束后通知父组件
      setTimeout(() => {
        this.triggerEvent('hide');
      }, 300);
    }
  }
}); 