Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.updateCurrentCategoryDescription();
        } else {
          this.setData({ testingSound: '' });
        }
      }
    },
    sounds: {
      type: Array,
      value: [],
      observer(newVal) {
        console.log('音色列表更新:', newVal);
        this.filterSoundsByCategory();
      }
    },
    soundCategories: {
      type: Array,
      value: [],
      observer(newVal) {
        console.log('音色分类更新:', newVal);
        if (newVal && newVal.length > 0 && !this.data.activeCategory) {
          this.setData({ activeCategory: newVal[0].id }, () => {
            this.filterSoundsByCategory();
          });
        }
      }
    },
    currentSound: {
      type: String,
      value: ''
    }
  },

  data: {
    activeCategory: '',
    filteredSounds: [],
    testingSound: '',
    testAudioPool: {
      accent: null,
      normal: null
    },
    testSequenceTimer: null,
    currentTestBeat: 0
  },

  observers: {
    'sounds, activeCategory': function() {
      this.filterSoundsByCategory();
    },
    'soundCategories': function(categories) {
      if (categories && categories.length > 0 && !this.data.activeCategory) {
        this.setData({ activeCategory: categories[0].id });
      }
    }
  },

  lifetimes: {
    attached() {
      // 初始化时设置默认分类
      if (this.data.soundCategories && this.data.soundCategories.length > 0) {
        this.setData({ activeCategory: this.data.soundCategories[0].id }, () => {
          this.filterSoundsByCategory();
        });
      }
    },

    detached() {
      // 清理资源
      this.stopTestSound();
      if (this.data.testSequenceTimer) {
        clearTimeout(this.data.testSequenceTimer);
      }
    }
  },

  methods: {
    // 更新当前分类的音色列表
    filterSoundsByCategory() {
      if (!this.data.activeCategory || !this.data.sounds) return;
      
      const filteredSounds = this.data.sounds.filter(
        sound => sound.category === this.data.activeCategory
      );
      
      this.setData({ filteredSounds });
    },

    // 切换分类
    onCategoryChange(e) {
      const category = e.currentTarget.dataset.category;
      if (category === this.data.activeCategory) return;
      
      // 停止当前试听
      this.stopTestSound();
      
      this.setData({ 
        activeCategory: category,
        testingSound: ''
      }, () => {
        this.filterSoundsByCategory();
        
        // 触感反馈
        wx.vibrateShort({
          type: 'light'
        });
      });
    },

    // 选择音色
    onSoundSelect(e) {
      const soundId = e.currentTarget.dataset.sound;
      if (!soundId || soundId === this.data.currentSound) return;
      
      // 停止当前试听
      this.stopTestSound();
      
      // 触发选择事件，传递完整的音色信息
      this.triggerEvent('select', { 
        soundId,
        soundFiles: {
          accent: `${wx.env.USER_DATA_PATH}/sounds/${soundId}_hard.mp3`,
          normal: `${wx.env.USER_DATA_PATH}/sounds/${soundId}_soft.mp3`
        }
      });
      
      // 触感反馈
      wx.vibrateShort({
        type: 'medium'
      });
    },

    // 试听音色
    onTestSound(e) {
      const soundId = e.currentTarget.dataset.sound;
      if (!soundId) return;
      
      if (this.data.testingSound === soundId) {
        this.stopTestSound();
      } else {
        this.playTestSound(soundId);
      }
      
      // 触感反馈
      wx.vibrateShort({
        type: 'light'
      });
    },

    // 播放试听音色
    playTestSound(soundId) {
      // 先停止当前试听
      this.stopTestSound();
      
      // 创建音频实例
      const accentAudio = wx.createInnerAudioContext();
      const normalAudio = wx.createInnerAudioContext();
      
      accentAudio.src = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_hard.mp3`;
      normalAudio.src = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_soft.mp3`;
      
      // 保存音频实例
      this.data.testAudioPool = {
        accent: accentAudio,
        normal: normalAudio
      };
      
      // 设置播放状态
      this.setData({ 
        testingSound: soundId,
        currentTestBeat: 0
      });
      
      // 定义播放序列
      const sequence = [
        { type: 'accent', delay: 0 },    // 第1拍：重音
        { type: 'normal', delay: 500 },  // 第2拍：轻音
        { type: 'accent', delay: 500 },  // 第3拍：重音
        { type: 'normal', delay: 500 }   // 第4拍：轻音
      ];
      
      // 播放序列
      const playSequence = (index = 0) => {
        if (index >= sequence.length || !this.data.testingSound) {
          this.stopTestSound();
          return;
        }
        
        const beat = sequence[index];
        const audio = this.data.testAudioPool[beat.type];
        
        if (audio) {
          try {
            audio.stop();
            setTimeout(() => {
              try {
                audio.play();
              } catch (error) {
                console.error('播放音频失败:', error);
              }
            }, 10);
          } catch (error) {
            console.error('停止音频失败:', error);
          }
        }
        
        // 更新当前拍子
        this.setData({ currentTestBeat: index });
        
        // 安排下一拍
        if (index < sequence.length - 1) {
          this.data.testSequenceTimer = setTimeout(() => {
            playSequence(index + 1);
          }, beat.delay);
        } else {
          // 播放完成后停止
          this.data.testSequenceTimer = setTimeout(() => {
            this.stopTestSound();
          }, beat.delay);
        }
      };
      
      // 开始播放序列
      playSequence();
    },

    // 停止试听
    stopTestSound() {
      // 清理定时器
      if (this.data.testSequenceTimer) {
        clearTimeout(this.data.testSequenceTimer);
        this.data.testSequenceTimer = null;
      }
      
      // 停止并销毁音频实例
      Object.values(this.data.testAudioPool).forEach(audio => {
        if (audio) {
          try {
            audio.stop();
            audio.destroy();
          } catch (error) {
            console.error('清理音频实例失败:', error);
          }
        }
      });
      
      // 重置状态
      this.data.testAudioPool = {
        accent: null,
        normal: null
      };
      
      this.setData({ 
        testingSound: '',
        currentTestBeat: 0
      });
    },

    // 关闭选择器
    onHide() {
      this.stopTestSound();
      this.triggerEvent('close');
    },

    // 阻止冒泡
    preventBubble() {
      // 什么都不做，仅阻止事件冒泡
    },

    updateCurrentCategoryDescription() {
      // Implementation of updateCurrentCategoryDescription method
    }
  }
}); 