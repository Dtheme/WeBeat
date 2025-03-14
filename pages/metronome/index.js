// 音频上下文管理
const audioPool = {
  normal: null,
  accent: null
};

let metronomeTimer = null;
let lastTapTime = 0;
const DOUBLE_TAP_DELAY = 300; // 双击判定时间间隔（毫秒）

Page({
  // 全局错误处理
  onError(error) {
    console.error('[Metronome] 全局错误:', error);
    // 停止节拍器
    if (this.data.isPlaying) {
      this.stopMetronome();
    }
    // 显示错误提示
    wx.showToast({
      title: '发生错误，已停止播放',
      icon: 'none',
      duration: 2000
    });
  },

  // Promise 未处理的 rejection 处理
  onUnhandledRejection(event) {
    console.error('[Metronome] 未处理的 Promise 错误:', {
      reason: event.reason,
      promise: event.promise
    });
    // 停止节拍器
    if (this.data.isPlaying) {
      this.stopMetronome();
    }
    // 显示错误提示
    wx.showToast({
      title: '发生异步错误，已停止播放',
      icon: 'none',
      duration: 2000
    });
  },

  data: {
    bpm: 120,
    minBpm: 30,
    maxBpm: 300,
    isPlaying: false,
    timeSignature: '4/4',
    currentBeat: 0,
    beats: [
      { type: 'accent', active: false },
      { type: 'normal', active: false },
      { type: 'normal', active: false },
      { type: 'normal', active: false }
    ],
    sounds: [
      // 基础音色
      { id: 'metronome_click', name: '节拍器', loaded: false, category: 'basic' },
      { id: 'beep', name: '蜂蜜', loaded: false, category: 'basic' },
      { id: 'click', name: '点击', loaded: false, category: 'basic' },
      { id: 'clock_tick', name: '时钟', loaded: false, category: 'basic' },
      { id: 'bell_chime', name: '钟声', loaded: false, category: 'basic' },
      { id: 'clave', name: '响棒', loaded: false, category: 'basic' },
      
      // 电子鼓组
      { id: '808_kick', name: '808底鼓', loaded: false, category: 'electronic' },
      { id: '808_snare', name: '808军鼓', loaded: false, category: 'electronic' },
      { id: '909_kick', name: '909底鼓', loaded: false, category: 'electronic' },
      { id: '909_snare', name: '909军鼓', loaded: false, category: 'electronic' },
      
      // 打击乐器
      { id: 'bongo_drum', name: '邦戈鼓', loaded: false, category: 'percussion' },
      { id: 'cowbell', name: '牛铃', loaded: false, category: 'percussion' },
      { id: 'hammer_hit', name: '锤击声', loaded: false, category: 'percussion' },
      { id: 'kick_drum', name: '大鼓', loaded: false, category: 'percussion' },
      { id: 'metal_hit', name: '金属声', loaded: false, category: 'percussion' },
      { id: 'percussion', name: '打击乐', loaded: false, category: 'percussion' },
      { id: 'rimshot', name: '鼓边击', loaded: false, category: 'percussion' },
      { id: 'rimshot_deep', name: '低音边击', loaded: false, category: 'percussion' },
      { id: 'snare_drum', name: '军鼓', loaded: false, category: 'percussion' },
      { id: 'woodblock', name: '木块', loaded: false, category: 'percussion' },
      { id: 'woodfish', name: '木鱼', loaded: false, category: 'percussion' }
    ],
    soundCategories: [
      { id: 'basic', name: '基础音色' },
      { id: 'electronic', name: '电子鼓组' },
      { id: 'percussion', name: '打击乐器' }
    ],
    currentSound: 'metronome_click',
    touchStartX: 0,
    touchStartY: 0,  // 新增：触摸起始Y坐标
    touchStartTime: 0,  // 新增：触摸开始时间
    lastTouchX: 0,  // 新增：上次触摸X坐标
    lastMoveTime: 0,  // 新增：上次移动时间
    moveSpeed: 0,  // 新增：移动速度
    bpmBeforeTouch: 0,
    sensitivity: 0.5,
    baseSensitivity: 0.5,  // 新增：基础灵敏度
    maxSensitivity: 2.0,  // 新增：最大灵敏度
    lastBpmChange: 0,  // 新增：上次BPM变化时间
    bpmChangeThreshold: 30,  // 新增：BPM变化阈值（毫秒）
    pendingBpm: 0,
    bpmUpdateTimer: null,
    lastVibrateTime: 0,  // 新增：上次震动时间
    vibrateThreshold: 100,  // 新增：震动阈值（毫秒）
    bpmAcceleration: 1,  // 新增：BPM调节加速度
    accelerationThreshold: 300,  // 新增：加速度触发阈值（毫秒）
    isAccelerating: false,  // 新增：是否处于加速状态
    soundsLoaded: false,
    loadingSound: false,
    testingSound: false,
    lastBpmUpdate: 0,  // 新增：上次BPM更新时间
    bpmUpdateThreshold: 50,  // 新增：BPM更新阈值（毫秒）
    lastBeatTap: 0,  // 新增：上次柱子点击时间
    beatTapThreshold: 200,  // 新增：柱子点击阈值（毫秒）
    lastBeatChange: 0,  // 新增：上次拍子变化时间
    beatChangeThreshold: 100,  // 新增：拍子变化阈值（毫秒）
    isChangingBeat: false,  // 新增：是否正在切换拍子
    nextBeatChange: null,  // 新增：下一个待切换的拍子状态
    beatChangeTimer: null,  // 新增：拍子切换定时器
    lastBpmAdjustment: 0,  // 新增：上次BPM调整时间
    bpmAdjustmentBuffer: [],  // 新增：BPM调整缓冲区
    bpmTransitionDuration: 200,  // 新增：BPM过渡持续时间（毫秒）
    isTransitioning: false,  // 新增：是否正在过渡
    playbackBuffer: null,  // 新增：播放缓冲定时器
    smartAcceleration: {  // 新增：智能加速度配置
      enabled: false,
      startTime: 0,
      lastSpeed: 0,
      threshold: 1.5,
      factor: 1.0
    },
    gestureState: {  // 新增：手势状态
      isAdjusting: false,
      startValue: 0,
      currentValue: 0,
      direction: 0
    },
    lastSoundChange: 0,  // 新增：上次音色切换时间
    soundChangeThreshold: 300,  // 新增：音色切换阈值（毫秒）
    soundLoadRetries: 3,  // 新增：音色加载重试次数
    soundLoadTimeout: 5000,  // 新增：音色加载超时时间（毫秒）
    showSoundPicker: false,
    currentSoundName: '节拍器'
  },

  onLoad() {
    console.log('[Metronome] 页面加载开始');
    
    // 获取设备信息 - 更新过时的API调用
    try {
      // 使用新的API替代wx.getSystemInfoSync
      const windowInfo = wx.getWindowInfo();
      const deviceInfo = wx.getDeviceInfo();
      const appBaseInfo = wx.getAppBaseInfo();
      
      // 存储需要的信息
      this.globalData = {
        statusBarHeight: windowInfo.statusBarHeight || 0,
        screenHeight: windowInfo.screenHeight || 0,
        screenWidth: windowInfo.screenWidth || 0,
        platform: deviceInfo.platform || '',
        brand: deviceInfo.brand || '',
        model: deviceInfo.model || '',
        system: deviceInfo.system || ''
      };
      
      console.log('[Metronome] 设备信息:', this.globalData);
    } catch (error) {
      console.error('[Metronome] 获取设备信息失败:', error);
    }
    
    this.initAudioPool();
    // 设置初始音色名称
    this.updateCurrentSoundName();
  },

  onShow() {
    console.log('[Metronome] 页面显示，当前音色:', this.data.currentSound);
    // 检查音频是否需要重新加载
    if (!this.data.soundsLoaded && !this.data.loadingSound) {
      console.log('[Metronome] 音频未加载，开始加载');
      this.loadSounds();
    }
  },

  onUnload() {
    console.log('[Metronome] 页面卸载，清理资源');
    this.stopMetronome();
    this.destroyAudioPool();
  },

  initAudioPool() {
    console.log('[Metronome] 初始化音频池');
    try {
      ['normal', 'accent'].forEach(type => {
        try {
          if (audioPool[type]) {
            try {
              audioPool[type].destroy();
            } catch (destroyError) {
              console.error(`[Metronome] 销毁音频实例 ${type} 失败:`, destroyError);
            }
          }
          
          const audio = wx.createInnerAudioContext({useWebAudioImplement: true});
          
          // iOS音频优化设置
          audio.autoplay = false;
          audio.obeyMuteSwitch = false;
          audio.volume = 1.0;
          
          // 错误监听
          audio.onError((err) => {
            console.error(`[Metronome] ${type}音频播放错误:`, err);
            // 不要在这里显示Toast，可能会导致频繁弹窗
          });

          audioPool[type] = audio;
          console.log(`[Metronome] 创建音频实例 ${type} 成功`);
        } catch (audioError) {
          console.error(`[Metronome] 创建音频实例 ${type} 失败:`, audioError);
          // 创建一个空的音频对象作为替代，防止后续代码报错
          audioPool[type] = {
            play: () => console.log(`[Metronome] 模拟播放 ${type}`),
            stop: () => console.log(`[Metronome] 模拟停止 ${type}`),
            destroy: () => console.log(`[Metronome] 模拟销毁 ${type}`),
            offError: () => {},
            offCanplay: () => {},
            onError: () => {},
            onCanplay: () => {}
          };
        }
      });

      // 确保文件存在
      this.copyAudioFiles();
      // 加载音频
      this.loadSounds().catch(err => {
        console.error('[Metronome] 初始化加载音频失败:', err);
      });
      
    } catch (error) {
      console.error('[Metronome] 初始化音频池失败:', error);
      wx.showToast({
        title: '音频初始化失败',
        icon: 'none'
      });
    }
  },

  destroyAudioPool() {
    console.log('[Metronome] 销毁音频池');
    Object.entries(audioPool).forEach(([type, audio]) => {
      if (audio) {
        try {
          audio.destroy();
          console.log(`[Metronome] 销毁音频实例 ${type} 成功`);
        } catch (error) {
          console.error(`[Metronome] 销毁音频实例 ${type} 失败:`, error);
        }
      }
    });
  },

  loadSounds() {
    // 如果正在加载，返回已存在的Promise
    if (this.data.loadingSound) {
      console.log('[Metronome] 音频正在加载中，等待当前加载完成');
      return Promise.reject(new Error('音频正在加载中'));
    }

    const currentSound = this.data.currentSound;
    console.log('[Metronome] 开始加载音频文件:', currentSound);
    
    // 重置加载状态
    this.setData({ 
      loadingSound: true,
      soundsLoaded: false
    });
    
    return new Promise((resolve, reject) => {
      try {
        // 使用完整的小程序路径
        const normalPath = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_soft.mp3`;
        const accentPath = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_hard.mp3`;
        
        console.log('[Metronome] 音频文件路径:', {
          normal: normalPath,
          accent: accentPath
        });

        // 检查文件是否存在并加载
        const loadAudio = (path, type) => {
          return new Promise((resolve, reject) => {
            try {
              const audio = audioPool[type];
              
              // 重置音频实例
              if (audio) {
                try {
                  audio.stop();
                } catch (stopError) {
                  console.error(`[Metronome] 停止音频失败 ${type}:`, stopError);
                }
                audio.offError();
                audio.offCanplay();
              }

              // 设置音频源
              audio.src = path;
              
              // 错误处理
              audio.onError((err) => {
                console.error(`[Metronome] ${type}音频加载失败:`, err);
                reject(err);
              });
              
              // 加载成功处理
              audio.onCanplay(() => {
                console.log(`[Metronome] ${type}音频加载成功:`, path);
                resolve();
              });

              // 预加载音频
              audio.volume = 0;
              audio.play();
              audio.stop();
              audio.volume = 1;
              
            } catch (error) {
              console.error(`[Metronome] ${type}音频加载异常:`, error);
              reject(error);
            }
          });
        };

        // 并行加载音频文件
        Promise.all([
          loadAudio(normalPath, 'normal'),
          loadAudio(accentPath, 'accent')
        ]).then(() => {
          console.log('[Metronome] 所有音频加载完成');
          
          // 更新音色加载状态
          const sounds = this.data.sounds.map(sound => ({
            ...sound,
            loaded: sound.id === currentSound
          }));
          
          this.setData({
            sounds,
            soundsLoaded: true,
            loadingSound: false
          }, () => {
            // 预热音频系统
            this.warmupAudioSystem();
            resolve();
          });
          
        }).catch((error) => {
          console.error('[Metronome] 音频加载失败:', error);
          this.handleAudioError('音频加载失败');
          this.setData({ 
            loadingSound: false,
            soundsLoaded: false
          });
          reject(error);
        });

      } catch (error) {
        console.error('[Metronome] 加载音频失败:', error);
        this.handleAudioError('音频加载失败');
        this.setData({ 
          loadingSound: false,
          soundsLoaded: false
        });
        reject(error);
      }
    });
  },

  // 预热音频系统
  warmupAudioSystem() {
    try {
      // 静音播放一次，预热音频系统
      ['normal', 'accent'].forEach(type => {
        try {
          const audio = audioPool[type];
          if (audio && typeof audio.play === 'function' && typeof audio.stop === 'function') {
            audio.volume = 0;
            
            try {
              audio.play();
              
              // 使用setTimeout而不是直接调用stop，避免iOS上的问题
              setTimeout(() => {
                try {
                  audio.stop();
                  audio.volume = 1;
                } catch (stopError) {
                  console.error(`[Metronome] 预热停止音频失败 ${type}:`, stopError);
                }
              }, 100);
            } catch (playError) {
              console.error(`[Metronome] 预热播放音频失败 ${type}:`, playError);
              audio.volume = 1;
            }
          }
        } catch (typeError) {
          console.error(`[Metronome] 预热音频系统类型错误 ${type}:`, typeError);
        }
      });
    } catch (error) {
      console.error('[Metronome] 预热音频系统失败:', error);
    }
  },

  handleAudioError(message) {
    console.error('[Metronome] 音频错误:', message);
    
    // 检查文件系统
    const fs = wx.getFileSystemManager();
    
    // 检查用户数据目录
    fs.readdir({
      dirPath: `${wx.env.USER_DATA_PATH}/sounds`,
      success: (res) => {
        console.log('[Metronome] sounds目录文件列表:', res.files);
        const currentSound = this.data.currentSound;
        const hasNormalFile = res.files.includes(`${currentSound}_soft.mp3`);
        const hasAccentFile = res.files.includes(`${currentSound}_hard.mp3`);
        console.log('[Metronome] 当前音色文件状态:', {
          normal: hasNormalFile,
          accent: hasAccentFile
        });

        // 如果文件不存在，尝试从小程序包内复制
        if (!hasNormalFile || !hasAccentFile) {
          this.copyAudioFiles();
        }
      },
      fail: (err) => {
        console.error('[Metronome] 无法读取sounds目录:', err);
        // 尝试创建目录并复制文件
        this.copyAudioFiles();
      }
    });

    wx.showToast({
      title: message,
      icon: 'none',
      duration: 2000
    });
    
    const sounds = this.data.sounds.map(sound => ({
      ...sound,
      loaded: false
    }));
    
    this.setData({ 
      soundsLoaded: false,
      sounds
    });
  },

  // 复制音频文件到用户目录
  copyAudioFiles() {
    try {
      const fs = wx.getFileSystemManager();
      const userPath = wx.env.USER_DATA_PATH;
      
      // 创建sounds目录 - 修复路径问题
      try {
        // 先检查目录是否存在
        try {
          fs.accessSync(`${userPath}/sounds`);
          console.log('[Metronome] sounds目录已存在');
        } catch (accessError) {
          // 目录不存在，创建它
          fs.mkdirSync(`${userPath}/sounds`);
          console.log('[Metronome] 创建sounds目录成功');
        }
      } catch (error) {
        console.error('[Metronome] 创建sounds目录失败:', error);
      }

      // 复制所有音频文件
      this.data.sounds.forEach(sound => {
        ['soft', 'hard'].forEach(type => {
          const fileName = `${sound.id}_${type}.mp3`;
          try {
            // 先检查目标文件是否已存在
            try {
              fs.accessSync(`${userPath}/sounds/${fileName}`);
              console.log(`[Metronome] 文件已存在: ${fileName}`);
            } catch (accessError) {
              // 文件不存在，复制它
              fs.copyFileSync(
                `/sounds/${fileName}`,
                `${userPath}/sounds/${fileName}`
              );
              console.log(`[Metronome] 复制文件成功: ${fileName}`);
            }
          } catch (error) {
            console.error(`[Metronome] 复制文件失败: ${fileName}`, error);
            // 尝试创建空文件以避免后续错误
            try {
              fs.accessSync(`${userPath}/sounds/${fileName}`);
            } catch (e) {
              // 文件不存在，尝试从其他音色复制一个作为替代
              try {
                fs.copyFileSync(
                  `/sounds/metronome_click_${type}.mp3`,
                  `${userPath}/sounds/${fileName}`
                );
                console.log(`[Metronome] 使用默认音色替代: ${fileName}`);
              } catch (fallbackError) {
                console.error(`[Metronome] 无法创建替代文件: ${fileName}`, fallbackError);
              }
            }
          }
        });
      });
    } catch (mainError) {
      console.error('[Metronome] 复制音频文件过程中发生错误:', mainError);
    }
  },

  // 处理圆圈点击
  onCircleTap() {
    try {
      const now = Date.now();
      if (now - lastTapTime < DOUBLE_TAP_DELAY) {
        // 双击检测到，切换播放状态
        this.togglePlay();
        lastTapTime = 0; // 重置最后点击时间
      } else {
        lastTapTime = now;
      }
    } catch (error) {
      console.error('[Metronome] 圆圈点击处理出错:', error);
      // 重置状态
      lastTapTime = 0;
      // 确保停止播放
      if (this.data.isPlaying) {
        this.stopMetronome();
      }
    }
  },

  togglePlay() {
    try {
      if (this.data.isPlaying) {
        this.stopMetronome();
      } else {
        // 检查音频是否已加载
        if (!this.data.soundsLoaded) {
          console.log('[Metronome] 音频未加载，先加载音频');
          wx.showToast({
            title: '正在准备音频...',
            icon: 'none',
            duration: 1500
          });
          
          this.setData({ loadingSound: true }, () => {
            this.loadSounds().then(() => {
              console.log('[Metronome] 音频加载完成，开始播放');
              this.startMetronome();
            }).catch(err => {
              console.error('[Metronome] 音频加载失败:', err);
              wx.showToast({
                title: '音频加载失败',
                icon: 'none'
              });
              this.setData({ loadingSound: false });
            });
          });
          return;
        }
        
        this.startMetronome();
      }
    } catch (error) {
      console.error('[Metronome] 切换播放状态出错:', error);
      // 确保停止播放
      this.stopMetronome();
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      });
    }
  },

  startMetronome() {
    try {
      // 添加BPM有效性检查
      if (!this.data.bpm || this.data.bpm < this.data.minBpm || this.data.bpm > this.data.maxBpm) {
        console.log('[Metronome] BPM无效，使用默认值120');
        this.setData({ bpm: 120 });
      }

      if (this.data.isPlaying) {
        console.log('[Metronome] 已经在播放中，忽略重复调用');
        return;
      }

      // 检查音频是否已加载
      if (!this.data.soundsLoaded) {
        console.log('[Metronome] 音频未加载，无法开始播放');
        wx.showToast({
          title: '音频未准备好',
          icon: 'none'
        });
        return;
      }

      console.log('[Metronome] 开始播放节拍器, BPM:', this.data.bpm);
      let currentBeat = 0;
      
      // 优化BPM计算逻辑
      const calculateBeatDuration = () => {
        // 基础BPM到毫秒的转换
        const baseDuration = 60000 / this.data.bpm;
        
        // 根据拍号调整持续时间
        switch (this.data.timeSignature) {
          case '6/8':
            // 6/8拍子中，每个八分音符的时值是四分音符的1/2
            return baseDuration / 2;
          case '3/4':
            // 3/4拍子保持标准四分音符时值
            return baseDuration;
          default: // 4/4
            return baseDuration;
        }
      };

      // 初始化节拍持续时间
      let beatDuration = calculateBeatDuration();
      let lastBeatTime = Date.now();
      let nextBeatScheduled = false;
      let driftCorrection = 0; // 累积时间偏差修正

      const scheduleNextBeat = (immediate = false) => {
        if (!this.data.isPlaying || nextBeatScheduled) return;
        
        const now = Date.now();
        const timeSinceLastBeat = now - lastBeatTime;
        
        // 计算下一拍的延迟时间，包含漂移修正
        let delay = beatDuration - timeSinceLastBeat + driftCorrection;
        
        // 处理BPM变化时的平滑过渡
        if (this.data.isTransitioning) {
          delay = Math.min(delay, this.data.bpmTransitionDuration);
          driftCorrection = 0; // 过渡期间重置漂移修正
        }
        
        // 确保延迟不会为负或过大
        delay = Math.max(0, Math.min(beatDuration * 1.5, immediate ? 0 : delay));
        
        nextBeatScheduled = true;

        // 使用setTimeout实现高精度计时
        const startTime = Date.now();
        const checkTime = () => {
          const elapsed = Date.now() - startTime;
          if (elapsed >= delay) {
            nextBeatScheduled = false;
            playBeat();
          } else if (this.data.isPlaying) {
            // 继续检查，使用较短的间隔提高精度
            setTimeout(checkTime, Math.min(1, delay - elapsed));
          }
        };

        if (delay > 0 && this.data.isPlaying) {
          metronomeTimer = setTimeout(checkTime, 1);
        } else {
          metronomeTimer = setTimeout(() => {
            nextBeatScheduled = false;
            playBeat();
          }, 0);
        }
      };

      const playBeat = () => {
        if (!this || !this.data || !this.data.isPlaying) return;

        try {
          const now = Date.now();
          const actualInterval = now - lastBeatTime;
          
          // 计算时间漂移
          if (lastBeatTime !== 0) {
            const drift = actualInterval - beatDuration;
            // 减小漂移修正的影响，使节拍更稳定
            driftCorrection = -drift * 0.3;
          }

          const beats = this.data.beats.map((beat, index) => ({
            ...beat,
            active: index === currentBeat
          }));

          this.setData({ beats });

          // 播放当前拍子音频
          if (beats[currentBeat] && beats[currentBeat].type !== 'skip') {
            this.playBeatSound(beats[currentBeat].type);
          }

          // 更新节拍状态
          lastBeatTime = now;
          currentBeat = (currentBeat + 1) % beats.length;
          
          // 跳过禁用的节拍
          while (beats[currentBeat] && beats[currentBeat].disabled) {
            currentBeat = (currentBeat + 1) % beats.length;
          }

          // 重置节拍显示状态
          setTimeout(() => {
            if (!this || !this.data || !this.data.isPlaying) return;
            const updatedBeats = beats.map(beat => ({
              ...beat,
              active: false
            }));
            this.setData({ beats: updatedBeats });
          }, Math.min(150, beatDuration * 0.25));

          // 更新节拍持续时间并安排下一拍
          beatDuration = calculateBeatDuration();
          scheduleNextBeat();

        } catch (error) {
          console.error('[Metronome] 播放拍子出错:', error);
          if (this.data.isPlaying) {
            scheduleNextBeat(true);
          }
        }
      };

      this.setData({ 
        isPlaying: true,
        isTransitioning: false
      }, () => {
        scheduleNextBeat(true);
      });

    } catch (error) {
      console.error('[Metronome] 启动节拍器出错:', error);
      this.stopMetronome();
      wx.showToast({
        title: '启动节拍器失败',
        icon: 'none'
      });
    }
  },

  stopMetronome() {
    console.log('[Metronome] 停止节拍器');
    try {
      if (metronomeTimer) {
        clearTimeout(metronomeTimer);
        metronomeTimer = null;
        console.log('[Metronome] 清理定时器完成');
      }
      
      // 清理拍子切换相关的定时器和状态
      if (this.data.beatChangeTimer) {
        clearTimeout(this.data.beatChangeTimer);
      }
      
      // 安全检查
      if (!Array.isArray(this.data.beats)) {
        console.error('[Metronome] 节拍数据无效');
        this.setData({ 
          isPlaying: false,
          currentBeat: 0,
          pendingBpm: this.data.bpm // 保持当前BPM值
        });
        return;
      }
      
      const beats = this.data.beats.map(beat => ({
        ...beat,
        active: false
      }));
      
      this.setData({ 
        isPlaying: false,
        beats,
        currentBeat: 0,
        isChangingBeat: false,
        nextBeatChange: null,
        beatChangeTimer: null,
        isTransitioning: false,
        pendingBpm: this.data.bpm // 保持当前BPM值
      }, () => {
        console.log('[Metronome] 停止状态已更新，保持BPM:', this.data.bpm);
      });
    } catch (error) {
      console.error('[Metronome] 停止节拍器出错:', error);
      this.setData({ 
        isPlaying: false,
        currentBeat: 0,
        isChangingBeat: false,
        nextBeatChange: null,
        beatChangeTimer: null,
        isTransitioning: false,
        pendingBpm: this.data.bpm // 保持当前BPM值
      });
    }
  },

  playBeatSound(beatType) {
    try {
      // 如果正在切换拍子，等待切换完成
      if (this.data.isChangingBeat) {
        setTimeout(() => {
          this.playBeatSound(beatType);
        }, 50);
        return;
      }

      const audio = audioPool[beatType === 'accent' ? 'accent' : 'normal'];
      if (!audio) {
        return;
      }

      // 安全检查
      if (typeof audio.play !== 'function' || typeof audio.stop !== 'function') {
        return;
      }

      // iOS音频播放优化
      try {
        audio.stop();
        setTimeout(() => {
          try {
            audio.play();
          } catch (playError) {
            console.error('[Metronome] 播放音频失败:', playError);
          }
        }, 10);
      } catch (stopError) {
        console.error('[Metronome] 停止音频失败:', stopError);
        try {
          audio.play();
        } catch (playError) {
          console.error('[Metronome] 直接播放音频失败:', playError);
        }
      }
    } catch (error) {
      console.error('[Metronome] 播放音频失败:', error);
      if (!this.data.isPlaying) {
        this.initAudioPool();
      }
    }
  },

  // BPM手势控制优化
  onTouchStart(e) {
    const now = Date.now();
    this.setData({
      touchStartX: e.touches[0].clientX,
      touchStartY: e.touches[0].clientY,
      touchStartTime: now,
      lastTouchX: e.touches[0].clientX,
      lastMoveTime: now,
      moveSpeed: 0,
      bpmBeforeTouch: this.data.bpm,
      pendingBpm: this.data.bpm, // 初始化 pendingBpm 为当前 BPM
      sensitivity: this.data.baseSensitivity,
      isAccelerating: false,
      bpmAcceleration: 1
    });
  },

  onTouchMove(e) {
    const now = Date.now();
    const deltaX = e.touches[0].clientX - this.data.touchStartX;
    const deltaY = Math.abs(e.touches[0].clientY - this.data.touchStartY);
    
    // 垂直移动检查
    if (deltaY > Math.abs(deltaX) * 0.5) return;

    // 计算移动速度和方向
    const timeDiff = now - this.data.lastMoveTime;
    const distance = e.touches[0].clientX - this.data.lastTouchX;
    const speed = Math.abs(distance / timeDiff);
    const direction = Math.sign(distance);
    
    // 更新手势状态
    const gestureState = {
      ...this.data.gestureState,
      isAdjusting: true,
      currentValue: this.data.bpmBeforeTouch + Math.round(deltaX * this.data.sensitivity),
      direction: direction
    };

    // 智能加速度处理
    const smartAcceleration = {...this.data.smartAcceleration};
    if (speed > smartAcceleration.threshold) {
      if (!smartAcceleration.enabled) {
        smartAcceleration.enabled = true;
        smartAcceleration.startTime = now;
      }
      smartAcceleration.lastSpeed = speed;
      smartAcceleration.factor = Math.min(2.5, 1 + (speed - smartAcceleration.threshold) * 0.5);
    } else if (smartAcceleration.enabled && speed < smartAcceleration.threshold * 0.7) {
      smartAcceleration.enabled = false;
      smartAcceleration.factor = 1.0;
    }

    // 计算新的BPM值，确保在有效范围内
    let bpmChange = Math.round(deltaX * this.data.sensitivity * (smartAcceleration.enabled ? smartAcceleration.factor : 1));
    const newBpm = Math.min(this.data.maxBpm, Math.max(this.data.minBpm, this.data.bpmBeforeTouch + bpmChange));

    // 处理BPM更新
    if (newBpm !== this.data.pendingBpm) {
      // 添加到调整缓冲区
      this.data.bpmAdjustmentBuffer.push({
        value: newBpm,
        timestamp: now
      });

      // 只保留最近1秒的调整记录
      const recentAdjustments = this.data.bpmAdjustmentBuffer.filter(
        adj => now - adj.timestamp < 1000
      );
      this.data.bpmAdjustmentBuffer = recentAdjustments;

      // 触感反馈
      if (now - this.data.lastVibrateTime > this.data.vibrateThreshold) {
        wx.vibrateShort({
          type: smartAcceleration.enabled ? 'medium' : 'light'
        });
        this.setData({ lastVibrateTime: now });
      }

      // 更新显示值
      this.setData({
        pendingBpm: newBpm,
        gestureState,
        smartAcceleration,
        lastMoveTime: now,
        lastTouchX: e.touches[0].clientX
      });

      // 节流更新实际BPM
      if (now - this.data.lastBpmChange > this.data.bpmChangeThreshold) {
        if (this.data.bpmUpdateTimer) {
          clearTimeout(this.data.bpmUpdateTimer);
        }

        this.data.bpmUpdateTimer = setTimeout(() => {
          const currentBpm = this.data.bpm;
          const targetBpm = this.data.pendingBpm;
          
          if (Math.abs(targetBpm - currentBpm) > 0) {
            this.setData({
              bpm: targetBpm,
              lastBpmChange: now,
              isTransitioning: true
            });

            // 平滑过渡
            if (this.data.isPlaying) {
              setTimeout(() => {
                this.setData({ isTransitioning: false });
              }, this.data.bpmTransitionDuration);
            }
          }
        }, this.data.bpmChangeThreshold);
      }
    }
  },

  onTouchEnd() {
    // 处理最终的BPM调整
    const finalAdjustments = this.data.bpmAdjustmentBuffer;
    if (finalAdjustments.length > 0) {
      const lastAdjustment = finalAdjustments[finalAdjustments.length - 1];
      const now = Date.now();
      
      // 计算调整的平均速度
      const adjustmentSpeed = finalAdjustments.length > 1 ? 
        Math.abs(lastAdjustment.value - finalAdjustments[0].value) / 
        (lastAdjustment.timestamp - finalAdjustments[0].timestamp) : 0;

      // 根据调整速度提供不同的触感反馈
      if (adjustmentSpeed > 1.0) {
        wx.vibrateShort({ type: 'heavy' });
      } else if (adjustmentSpeed > 0.5) {
        wx.vibrateShort({ type: 'medium' });
      } else {
        wx.vibrateShort({ type: 'light' });
      }
    }

    // 清理状态
    this.setData({
      moveSpeed: 0,
      sensitivity: this.data.baseSensitivity,
      isAccelerating: false,
      bpmAcceleration: 1,
      gestureState: {
        isAdjusting: false,
        startValue: 0,
        currentValue: 0,
        direction: 0
      },
      smartAcceleration: {
        enabled: false,
        startTime: 0,
        lastSpeed: 0,
        threshold: 1.5,
        factor: 1.0
      },
      bpmAdjustmentBuffer: []
    });

    // 确保最终BPM更新
    if (this.data.bpmUpdateTimer) {
      clearTimeout(this.data.bpmUpdateTimer);
    }
    
    if (this.data.pendingBpm !== this.data.bpm) {
      const wasPlaying = this.data.isPlaying;
      
      this.setData({
        bpm: this.data.pendingBpm,
        lastBpmChange: Date.now(),
        isTransitioning: true
      }, () => {
        if (wasPlaying) {
          // 使用缓冲定时器确保平滑过渡
          if (this.data.playbackBuffer) {
            clearTimeout(this.data.playbackBuffer);
          }
          
          this.data.playbackBuffer = setTimeout(() => {
            this.setData({ isTransitioning: false });
          }, this.data.bpmTransitionDuration);
        }
      });
    }
  },

  restartMetronome() {
    this.stopMetronome();
    this.startMetronome();
  },

  // 切换节拍类型优化
  onBeatTap(e) {
    try {
      const now = Date.now();
      const index = e.currentTarget.dataset.index;
      
      // 基础验证
      if (index === undefined || index === null) {
        return;
      }
      
      const beats = [...this.data.beats];
      if (!beats[index] || beats[index].disabled) {
        return;
      }

      // 防抖处理
      if (now - this.data.lastBeatTap < this.data.beatTapThreshold) {
        return;
      }
      
      // 如果正在切换拍子，将新的变化加入队列
      if (this.data.isChangingBeat) {
        // 取消之前等待的变化
        if (this.data.beatChangeTimer) {
          clearTimeout(this.data.beatChangeTimer);
        }
        
        // 存储新的变化
        this.data.nextBeatChange = {
          index,
          timestamp: now
        };
        return;
      }

      this.setData({ 
        lastBeatTap: now,
        isChangingBeat: true 
      });

      const types = ['normal', 'accent', 'skip'];
      const currentType = beats[index].type;
      const typeIndex = types.indexOf(currentType);
      if (typeIndex === -1) {
        this.setData({ isChangingBeat: false });
        return;
      }

      const nextTypeIndex = (typeIndex + 1) % types.length;
      const wasPlaying = this.data.isPlaying;
      
      // 如果正在播放，使用更平滑的切换
      if (wasPlaying && this.data.currentBeat === index) {
        // 等待当前拍子播放完成再切换
        this.data.beatChangeTimer = setTimeout(() => {
          beats[index] = {
            ...beats[index],
            type: types[nextTypeIndex]
          };
          
          this.setData({ 
            beats,
            isChangingBeat: false
          }, () => {
            // 处理队列中的下一个变化
            if (this.data.nextBeatChange) {
              const { index: nextIndex, timestamp } = this.data.nextBeatChange;
              this.data.nextBeatChange = null;
              if (now - timestamp < 1000) { // 只处理1秒内的变化
                this.onBeatTap({ currentTarget: { dataset: { index: nextIndex } } });
              }
            }
          });
        }, this.data.beatChangeThreshold);
      } else {
        // 非播放状态或非当前拍子，直接切换
        beats[index] = {
          ...beats[index],
          type: types[nextTypeIndex]
        };
        
        this.setData({ 
          beats,
          isChangingBeat: false
        }, () => {
          // 处理队列中的下一个变化
          if (this.data.nextBeatChange) {
            const { index: nextIndex, timestamp } = this.data.nextBeatChange;
            this.data.nextBeatChange = null;
            if (now - timestamp < 1000) { // 只处理1秒内的变化
              this.onBeatTap({ currentTarget: { dataset: { index: nextIndex } } });
            }
          }
        });
      }

    } catch (error) {
      console.error('[Metronome] 切换节拍类型出错:', error);
      this.setData({ isChangingBeat: false });
    }
  },

  // 切换拍号优化
  changeTimeSignature(e) {
    try {
      const pattern = e.currentTarget.dataset.pattern;
      if (pattern === this.data.timeSignature) {
        return;
      }

      const wasPlaying = this.data.isPlaying;
      let beats;
      
      switch (pattern) {
        case '3/4':
          beats = [
            { type: 'accent', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false },
            { type: 'skip', active: false, disabled: true }
          ];
          break;
        case '6/8':
          beats = [
            { type: 'accent', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false }
          ];
          break;
        default: // 4/4
          beats = [
            { type: 'accent', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false }
          ];
      }

      // 使用回调确保状态更新完成后再重启
      this.setData({
        timeSignature: pattern,
        beats,
        currentBeat: 0
      }, () => {
        if (wasPlaying) {
          this.startMetronome();
        }
      });

    } catch (error) {
      console.error('[Metronome] 切换拍号出错:', error);
    }
  },

  // 切换音色优化
  changeSound(e) {
    const now = Date.now();
    const soundId = e.currentTarget.dataset.sound;
    
    console.log('[Metronome] 切换音色:', soundId);
    
    // 防抖处理
    if (now - this.data.lastSoundChange < this.data.soundChangeThreshold) {
      console.log('[Metronome] 音色切换太频繁，忽略请求');
      return;
    }
    
    if (this.data.loadingSound || soundId === this.data.currentSound) {
      console.log('[Metronome] 音色正在加载或相同音色，忽略请求');
      return;
    }
    
    const wasPlaying = this.data.isPlaying;
    let retryCount = 0;
    let loadTimeout = null;
    
    // 预加载新音色
    const loadNewSound = () => {
      // 清理之前的超时计时器
      if (loadTimeout) {
        clearTimeout(loadTimeout);
      }

      // 如果正在播放，先停止
      if (wasPlaying) {
        this.stopMetronome();
      }

      // 更新状态前先重置
      this.setData({ 
        currentSound: soundId,
        soundsLoaded: false,
        loadingSound: false,
        lastSoundChange: now
      }, () => {
        // 设置加载超时
        loadTimeout = setTimeout(() => {
          if (this.data.loadingSound) {
            console.error('[Metronome] 音色加载超时:', soundId);
            handleLoadError(new Error('加载超时'));
          }
        }, this.data.soundLoadTimeout);

        // 开始加载
        this.loadSounds()
          .then(() => {
            if (loadTimeout) {
              clearTimeout(loadTimeout);
              loadTimeout = null;
            }
            
            console.log('[Metronome] 音色加载成功:', soundId);
            
            // 添加触感反馈
            wx.vibrateShort({ type: 'light' });
            
            // 如果之前在播放，恢复播放
            if (wasPlaying) {
              this.startMetronome();
            }
          })
          .catch(error => {
            console.error('[Metronome] 加载音色失败:', error);
            handleLoadError(error);
          });
      });
    };

    const handleLoadError = (error) => {
      // 清理超时计时器
      if (loadTimeout) {
        clearTimeout(loadTimeout);
        loadTimeout = null;
      }

      retryCount++;
      
      if (retryCount < this.data.soundLoadRetries) {
        console.log(`[Metronome] 重试加载音色 (${retryCount}/${this.data.soundLoadRetries})`);
        setTimeout(loadNewSound, 500 * retryCount); // 递增重试延迟
      } else {
        // 恢复到之前的音色
        console.error('[Metronome] 音色加载失败，恢复原音色');
        this.setData({ 
          loadingSound: false,
          soundsLoaded: false
        }, () => {
          // 重新加载原音色
          this.loadSounds().then(() => {
            // 如果之前在播放，恢复播放
            if (wasPlaying) {
              this.startMetronome();
            }
          }).catch(err => {
            console.error('[Metronome] 恢复原音色失败:', err);
          });
        });

        wx.showToast({
          title: '音色加载失败',
          icon: 'none'
        });
      }
    };

    // 开始加载新音色
    loadNewSound();
  },

  // 测试当前音色优化
  testCurrentSound() {
    if (this.data.loadingSound) {
      wx.showToast({
        title: '音频加载中',
        icon: 'none'
      });
      return;
    }

    if (!this.data.soundsLoaded) {
      wx.showToast({
        title: '音频未加载',
        icon: 'none'
      });
      return;
    }

    if (this.data.testingSound) {
      return; // 防止重复测试
    }

    console.log('[Metronome] 测试音色:', this.data.currentSound);
    
    this.setData({ testingSound: true });
    
    try {
      // iOS音频播放优化
      const playAudioWithDelay = (audio, volume = 1) => {
        return new Promise((resolve, reject) => {
          try {
            audio.volume = volume;
            audio.stop();
            
            setTimeout(() => {
              try {
                audio.play();
                resolve();
              } catch (playError) {
                console.error('[Metronome] 播放音频失败:', playError);
                reject(playError);
              }
            }, 10);
          } catch (error) {
            reject(error);
          }
        });
      };

      // 播放测试序列：重音 -> 普通音 -> 重音（弱）
      playAudioWithDelay(audioPool.accent)
        .then(() => new Promise(resolve => setTimeout(resolve, 300)))
        .then(() => playAudioWithDelay(audioPool.normal))
        .then(() => new Promise(resolve => setTimeout(resolve, 300)))
        .then(() => playAudioWithDelay(audioPool.accent, 0.6))
        .then(() => new Promise(resolve => setTimeout(resolve, 300)))
        .then(() => {
          this.setData({ testingSound: false });
          // 添加触感反馈
          wx.vibrateShort({ type: 'light' });
        })
        .catch(error => {
          console.error('[Metronome] 测试音频失败:', error);
          this.setData({ testingSound: false });
          
          wx.showToast({
            title: '音频播放失败',
            icon: 'none'
          });

          // 尝试重新初始化音频
          this.initAudioPool();
        });

    } catch (error) {
      console.error('[Metronome] 测试音频失败:', error);
      this.setData({ testingSound: false });
      
      wx.showToast({
        title: '音频播放失败',
        icon: 'none'
      });
      
      // 尝试重新初始化音频
      this.initAudioPool();
    }
  },

  // 更新当前音色名称
  updateCurrentSoundName() {
    const currentSound = this.data.sounds.find(s => s.id === this.data.currentSound);
    if (currentSound) {
      this.setData({
        currentSoundName: currentSound.name
      });
    }
  },

  // 显示音色选择器
  showSoundPicker() {
    this.setData({ showSoundPicker: true });
  },

  // 关闭音色选择器
  onSoundPickerClose() {
    this.setData({ showSoundPicker: false });
  },

  // 选择音色
  onSoundSelect(e) {
    const { sound } = e.detail;
    this.changeSound({ currentTarget: { dataset: { sound } } });
    this.updateCurrentSoundName();
  },

  // 试听音色
  onSoundTest(e) {
    const { sound } = e.detail;
    // 临时切换音色进行试听
    const originalSound = this.data.currentSound;
    this.setData({ currentSound: sound }, () => {
      this.testCurrentSound();
      // 恢复原来的音色
      setTimeout(() => {
        this.setData({ currentSound: originalSound });
      }, 1000);
    });
  },
}); 