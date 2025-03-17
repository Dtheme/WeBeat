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
      
      // 创建音频实例 - 使用多个实例避免播放冲突
      const audioInstances = {
        accent1: wx.createInnerAudioContext(),
        normal1: wx.createInnerAudioContext(),
        accent2: wx.createInnerAudioContext(),
        normal2: wx.createInnerAudioContext()
      };
      
      // 设置音频源
      Object.keys(audioInstances).forEach(key => {
        const isAccent = key.startsWith('accent');
        audioInstances[key].src = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_${isAccent ? 'hard' : 'soft'}.mp3`;
        audioInstances[key].obeyMuteSwitch = false;
        audioInstances[key].volume = 1.0;
      });
      
      // 保存音频实例
      this.data.testAudioPool = audioInstances;
      
      // 设置播放状态
      this.setData({ 
        testingSound: soundId,
        currentTestBeat: 0
      });
      
      // 计算72bpm下每拍的间隔时间（毫秒）
      const beatInterval = Math.round(60000 / 72); // 约833ms
      
      // 预加载所有音频
      const preloadAudios = () => {
        return new Promise((resolve) => {
          let loadedCount = 0;
          const totalCount = Object.keys(audioInstances).length;
          
          const onCanPlay = () => {
            loadedCount++;
            if (loadedCount >= totalCount) {
              resolve();
            }
          };
          
          // 为每个音频实例设置加载完成事件
          Object.values(audioInstances).forEach(audio => {
            audio.onCanplay(() => {
              onCanPlay();
            });
            
            // 处理加载错误
            audio.onError(() => {
              console.error('音频加载失败');
              onCanPlay(); // 即使失败也计数，避免卡住
            });
          });
          
          // 设置超时，防止永久等待
          setTimeout(() => {
            if (loadedCount < totalCount) {
              console.log('音频加载超时，继续播放');
              resolve();
            }
          }, 1000);
        });
      };
      
      // 使用AudioContext API进行精确定时播放
      const playWithPrecision = async () => {
        try {
          // 等待预加载完成
          await preloadAudios();
          
          // 播放序列
          const sequence = [
            { audio: audioInstances.accent1, beat: 0 },
            { audio: audioInstances.normal1, beat: 1 },
            { audio: audioInstances.accent2, beat: 2 },
            { audio: audioInstances.normal2, beat: 3 }
          ];
          
          // 记录开始时间
          const startTime = Date.now();
          
          // 播放函数
          const playNextBeat = (index) => {
            if (index >= sequence.length || !this.data.testingSound) {
              // 播放完成后停止
              setTimeout(() => {
                this.stopTestSound();
              }, beatInterval);
              return;
            }
            
            const { audio, beat } = sequence[index];
            
            // 计算实际应该播放的时间
            const expectedTime = startTime + (index * beatInterval);
            const now = Date.now();
            const delay = Math.max(0, expectedTime - now);
            
            // 使用setTimeout进行更精确的定时
            this.data.testSequenceTimer = setTimeout(() => {
              // 更新UI
              this.setData({ currentTestBeat: beat });
              
              // 播放音频
              try {
                audio.play();
              } catch (e) {
                console.error('播放失败:', e);
              }
              
              // 安排下一拍
              playNextBeat(index + 1);
            }, delay);
          };
          
          // 开始播放
          playNextBeat(0);
          
        } catch (error) {
          console.error('播放出错:', error);
          this.stopTestSound();
        }
      };
      
      // 开始精确播放
      playWithPrecision();
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