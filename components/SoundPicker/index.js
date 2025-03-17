Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    sounds: {
      type: Array,
      value: []
    },
    soundCategories: {
      type: Array,
      value: []
    },
    currentSound: {
      type: String,
      value: ''
    }
  },

  data: {
    activeCategory: 'basic',
    animation: null,
    containerAnimation: null
  },

  lifetimes: {
    attached() {
      this.initAnimation();
    }
  },

  methods: {
    initAnimation() {
      const animation = wx.createAnimation({
        duration: 300,
        timingFunction: 'ease-out'
      });
      
      const containerAnimation = wx.createAnimation({
        duration: 300,
        timingFunction: 'ease-out'
      });

      this.animation = animation;
      this.containerAnimation = containerAnimation;
    },

    onShow() {
      this.containerAnimation.backgroundColor('rgba(0, 0, 0, 0.5)').step();
      this.animation.translateY(0).opacity(1).step();
      
      this.setData({
        animation: this.animation.export(),
        containerAnimation: this.containerAnimation.export()
      });
    },

    onHide() {
      this.containerAnimation.backgroundColor('rgba(0, 0, 0, 0)').step();
      this.animation.translateY('100%').opacity(0).step();
      
      this.setData({
        animation: this.animation.export(),
        containerAnimation: this.containerAnimation.export()
      });

      setTimeout(() => {
        this.triggerEvent('close');
      }, 300);
    },

    onCategoryChange(e) {
      const category = e.currentTarget.dataset.category;
      this.setData({ activeCategory: category });
    },

    onSoundSelect(e) {
      const sound = e.currentTarget.dataset.sound;
      this.triggerEvent('select', { sound });
      this.onHide();
    },

    onTestSound(e) {
      const sound = e.currentTarget.dataset.sound;
      this.triggerEvent('test', { sound });
    },

    preventBubble() {}
  }
});