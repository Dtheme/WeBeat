// 音频上下文管理
const audioPool = {
  normal: {
    current: null,
    next: null
  },
  accent: {
    current: null,
    next: null
  }
};

// 音频文件管理器
const AudioFileManager = {
  // 检查音频文件是否存在
  checkAudioFile(soundId, type) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_${type}.mp3`;
      
      try {
        fs.accessSync(filePath);
        resolve(true);
      } catch (error) {
        resolve(false);
      }
    });
  },

  // 确保音频目录存在
  ensureAudioDirectory() {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      const dirPath = `${wx.env.USER_DATA_PATH}/sounds`;
      
      try {
        try {
          fs.accessSync(dirPath);
          console.log('[Metronome] sounds目录已存在');
        } catch (error) {
          fs.mkdirSync(dirPath);
          console.log('[Metronome] 创建sounds目录成功');
        }
        resolve();
      } catch (error) {
        console.error('[Metronome] 创建sounds目录失败:', error);
        reject(error);
      }
    });
  },

  // 复制音频文件
  copyAudioFile(soundId, type) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      const fileName = `${soundId}_${type}.mp3`;
      const targetPath = `${wx.env.USER_DATA_PATH}/sounds/${fileName}`;
      
      try {
        // 先检查目标文件是否存在
        try {
          fs.accessSync(targetPath);
          console.log(`[Metronome] 文件已存在: ${fileName}`);
          resolve(targetPath);
          return;
        } catch (error) {
          // 文件不存在，继续复制
        }

        // 从小程序包内复制文件
        fs.copyFileSync(
          `/sounds/${fileName}`,
          targetPath
        );
        console.log(`[Metronome] 复制文件成功: ${fileName}`);
        resolve(targetPath);
      } catch (error) {
        console.error(`[Metronome] 复制文件失败: ${fileName}`, error);
        reject(error);
      }
    });
  },

  // 复制所有音频文件
  async copyAllAudioFiles(sounds) {
    await this.ensureAudioDirectory();
    
    const copyPromises = [];
    sounds.forEach(sound => {
      ['soft', 'hard'].forEach(type => {
        copyPromises.push(
          this.copyAudioFile(sound.id, type).catch(error => {
            console.error(`[Metronome] 复制音频文件失败: ${sound.id}_${type}`, error);
            // 使用默认音色作为备选
            return this.copyAudioFile('metronome_click', type);
          })
        );
      });
    });

    return Promise.all(copyPromises);
  }
};

let metronomeTimer = null;
let lastTapTime = 0;
const DOUBLE_TAP_DELAY = 300; // 双击判定时间间隔（毫秒）

// 音频预加载管理器
const AudioPreloadManager = {
  // 预加载音频实例
  preloadAudio(type, soundId) {
    const audio = wx.createInnerAudioContext({ useWebAudioImplement: true });
    audio.src = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_${type === 'accent' ? 'hard' : 'soft'}.mp3`;
    
    // iOS音频优化设置
    audio.autoplay = false;
    audio.obeyMuteSwitch = false;
    audio.volume = 1.0;

    return new Promise((resolve, reject) => {
      audio.onCanplay(() => {
        // 预热音频系统
        audio.volume = 0;
        audio.play();
        audio.stop();
        audio.volume = 1;
        resolve(audio);
      });

      audio.onError((err) => {
        console.error(`[Metronome] 预加载音频失败 ${type}:`, err);
        reject(err);
      });
    });
  },

  // 切换到预加载的音频
  switchToPreloaded(type) {
    if (audioPool[type].next) {
      // 销毁当前音频
      if (audioPool[type].current) {
        audioPool[type].current.destroy();
      }
      // 将预加载的音频设置为当前音频
      audioPool[type].current = audioPool[type].next;
      audioPool[type].next = null;
    }
  },

  // 清理音频资源
  cleanup(type) {
    ['current', 'next'].forEach(slot => {
      if (audioPool[type][slot]) {
        audioPool[type][slot].destroy();
        audioPool[type][slot] = null;
      }
    });
  }
};

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
    minBpm: 40,
    maxBpm: 240,
    isPlaying: false,
    timeSignature: '4/4',
    currentBeat: 0,
    beats: [
      { type: 'accent', active: false },
      { type: 'normal', active: false },
      { type: 'normal', active: false },
      { type: 'normal', active: false }
    ],
    // 自定义拍号相关
    isCustomTimeSignature: false,
    showCustomModal: false,
    customBeatsCount: 4,
    customBeatValue: 4,
    customTimeSignature: '',
    customBeatsEmphasis: [true, false, false, false],
    showBeatValueSelector: true,
    minBeatsCount: 2,
    maxBeatsCount: 12,
    // 音色相关
    sounds: [
      // 基础音色
      { id: 'metronome_click', name: '节拍器', category: 'basic', description: '标准节拍器音色' },
      { id: 'beep', name: '蜂鸣', category: 'basic', description: '简单清晰的电子音' },
      { id: 'click', name: '点击', category: 'basic', description: '轻快的点击声' },
      { id: 'clock_tick', name: '时钟', category: 'basic', description: '时钟滴答声' },
      { id: 'bell_chime', name: '铃声', category: 'basic', description: '清脆的铃铛声' },
      { id: 'clave', name: '响棒', category: 'basic', description: '木质响棒声' },
      
      // 电子鼓组
      { id: '808_kick', name: '808底鼓', category: 'electronic', description: '经典808电子底鼓' },
      { id: '808_snare', name: '808军鼓', category: 'electronic', description: '经典808电子军鼓' },
      { id: '909_kick', name: '909底鼓', category: 'electronic', description: '经典909电子底鼓' },
      { id: '909_snare', name: '909军鼓', category: 'electronic', description: '经典909电子军鼓' },
      
      // 打击乐器
      { id: 'bongo_drum', name: '邦戈鼓', category: 'percussion', description: '拉丁打击乐器' },
      { id: 'cowbell', name: '牛铃', category: 'percussion', description: '金属牛铃声' },
      { id: 'hammer_hit', name: '锤击', category: 'percussion', description: '金属锤击声' },
      { id: 'kick_drum', name: '大鼓', category: 'percussion', description: '低沉大鼓声' },
      { id: 'metal_hit', name: '金属', category: 'percussion', description: '金属打击声' },
      { id: 'rimshot', name: '鼓边击', category: 'percussion', description: '军鼓边缘击打声' },
      { id: 'rimshot_deep', name: '低音边击', category: 'percussion', description: '低音军鼓边缘击打声' },
      { id: 'snare_drum', name: '军鼓', category: 'percussion', description: '标准军鼓声' },
      { id: 'woodblock', name: '木块', category: 'percussion', description: '木块打击声' },
      { id: 'woodfish', name: '木鱼', category: 'percussion', description: '传统木鱼声' }
    ],
    soundCategories: [
      { id: 'basic', name: '基础音色', icon: '🎵', description: '简单清晰的基础节拍音色' },
      { id: 'electronic', name: '电子鼓组', icon: '🎛', description: '经典电子鼓机音色' },
    ],
    currentSound: 'metronome_click',
    touchStartX: 0,
    touchStartY: 0,  // 触摸起始Y坐标
    touchStartTime: 0,  // 触摸开始时间
    lastTouchX: 0,  // 上次触摸X坐标
    lastMoveTime: 0,  // 上次移动时间
    moveSpeed: 0,  // 移动速度
    bpmBeforeTouch: 0,
    sensitivity: 0.5,
    baseSensitivity: 0.5,  // 基础灵敏度
    maxSensitivity: 2.0,  // 最大灵敏度
    lastBpmChange: 0,  // 上次BPM变化时间
    bpmChangeThreshold: 30,  // BPM变化阈值（毫秒）
    pendingBpm: 0,
    bpmUpdateTimer: null,
    lastVibrateTime: 0,  // 上次震动时间
    vibrateThreshold: 100,  // 震动阈值（毫秒）
    bpmAcceleration: 1,  // BPM调节加速度
    accelerationThreshold: 300,  // 加速度触发阈值（毫秒）
    isAccelerating: false,  // 是否处于加速状态
    soundsLoaded: false,
    loadingSound: false,
    testingSound: false,
    lastBpmUpdate: 0,  // 上次BPM更新时间
    bpmUpdateThreshold: 50,  // BPM更新阈值（毫秒）
    lastBeatTap: 0,  // 上次柱子点击时间
    beatTapThreshold: 200,  // 柱子点击阈值（毫秒）
    lastBeatChange: 0,  // 上次拍子变化时间
    beatChangeThreshold: 100,  // 拍子变化阈值（毫秒）
    isChangingBeat: false,  // 是否正在切换拍子
    nextBeatChange: null,  // 下一个待切换的拍子状态
    beatChangeTimer: null,  // 拍子切换定时器
    lastBpmAdjustment: 0,  // 上次BPM调整时间
    bpmAdjustmentBuffer: [],  // BPM调整缓冲区
    bpmTransitionDuration: 200,  // BPM过渡持续时间（毫秒）
    isTransitioning: false,  // 是否正在过渡
    playbackBuffer: null,  // 播放缓冲定时器
    smartAcceleration: {  // 智能加速度配置
      enabled: false,
      startTime: 0,
      lastSpeed: 0,
      threshold: 1.5,
      factor: 1.0
    },
    gestureState: {  // 手势状态
      isAdjusting: false,
      startValue: 0,
      currentValue: 0,
      direction: 0
    },
    lastSoundChange: 0,  // 上次音色切换时间
    soundChangeThreshold: 300,  // 音色切换阈值（毫秒）
    soundLoadRetries: 3,  // 音色加载重试次数
    soundLoadTimeout: 5000,  // 音色加载超时时间（毫秒）
    showSoundPicker: false,
    currentSoundName: '节拍器',
    tapTempoEnabled: false,
    tapTempoCount: 0,
    tapTempoTimes: [],
    tapTempoTimeout: null,
    tapTempoMaxSamples: 8,  // 最大采样数
    tapTempoResetDelay: 2000,  // 重置延迟（毫秒）
    tapTempoMinInterval: 200,  // 最小点击间隔（毫秒）
    tapTempoMaxInterval: 2000,  // 最大点击间隔（毫秒）
    bpmChangeInterval: null,
    bpmChangeTimeout: null,
    isMenuExpanded: false,
    snapPoints: [
      { value: 60, label: '60' },
      { value: 80, label: '80' },
      { value: 100, label: '100' },
      { value: 120, label: '120' },
      { value: 128, label: '128' },
      { value: 140, label: '140' },
      { value: 160, label: '160' }
    ],
    isSnapping: false,
    snapThreshold: 1, 
    lastSnapTime: 0,
    snapCooldown: 150,
    snapAnimationDuration: 150,
    isDragging: false,
    dragStartBpm: 0,
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
    
    // 恢复用户设置
    try {
      // 恢复BPM设置
      const savedBpm = wx.getStorageSync('metronome_bpm');
      if (savedBpm) {
        const bpm = parseInt(savedBpm);
        if (!isNaN(bpm) && bpm >= this.data.minBpm && bpm <= this.data.maxBpm) {
          this.setData({ bpm });
        }
      }
      
      // 恢复拍号设置
      const savedTimeSignature = wx.getStorageSync('metronome_time_signature');
      const savedCustomData = wx.getStorageSync('metronome_custom_time_signature');
      
      if (savedCustomData) {
        try {
          // 恢复自定义拍号
          const customData = JSON.parse(savedCustomData);
          if (customData && customData.timeSignature) {
            const [beatsCount, beatValue] = customData.timeSignature.split('/').map(Number);
            
            // 验证数据有效性
            if (beatsCount >= this.data.minBeatsCount && 
                beatsCount <= this.data.maxBeatsCount && 
                [2, 4, 8, 16].includes(beatValue)) {
              
              // 恢复拍子和重音设置
              let beats = [];
              if (customData.beats && Array.isArray(customData.beats)) {
                beats = customData.beats;
              } else {
                // 如果没有保存拍子设置，创建默认设置
                for (let i = 0; i < beatsCount; i++) {
                  beats.push({
                    type: i === 0 ? 'accent' : 'normal',
                    active: false
                  });
                }
              }
              
              this.setData({
                timeSignature: customData.timeSignature,
                beats: beats,
                isCustomTimeSignature: true,
                customTimeSignature: customData.timeSignature,
                customBeatsCount: beatsCount,
                customBeatValue: beatValue,
                customBeatsEmphasis: beats.map(beat => beat.type === 'accent')
              });
            }
          }
        } catch (err) {
          console.error('[Metronome] 解析自定义拍号数据失败:', err);
        }
      } else if (savedTimeSignature) {
        // 恢复标准拍号
        switch (savedTimeSignature) {
          case '3/4':
            this.setData({
              timeSignature: savedTimeSignature,
              beats: [
                { type: 'accent', active: false },
                { type: 'normal', active: false },
                { type: 'normal', active: false },
                { type: 'skip', active: false, disabled: true }
              ],
              isCustomTimeSignature: false
            });
            break;
          case '6/8':
            this.setData({
              timeSignature: savedTimeSignature,
              beats: [
                { type: 'accent', active: false },
                { type: 'normal', active: false },
                { type: 'normal', active: false },
                { type: 'normal', active: false },
                { type: 'normal', active: false },
                { type: 'normal', active: false }
              ],
              isCustomTimeSignature: false
            });
            break;
          default: // 4/4 或其他
            if (savedTimeSignature !== '4/4') {
              console.log('[Metronome] 未识别的拍号设置:', savedTimeSignature, '使用默认值4/4');
            }
            // 不修改默认值
            break;
        }
      }
      
      // 恢复音色设置
      const savedSound = wx.getStorageSync('metronome_sound');
      if (savedSound) {
        // 验证音色是否存在
        const soundExists = this.data.sounds.some(s => s.id === savedSound);
        if (soundExists) {
          this.setData({ currentSound: savedSound });
        }
      }
    } catch (err) {
      console.error('[Metronome] 恢复设置失败:', err);
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

  async initAudioPool() {
    console.log('[Metronome] 初始化音频池');
    try {
      // 确保音频文件存在
      await AudioFileManager.copyAllAudioFiles(this.data.sounds);
      
      // 重置音频状态
      this.setData({ 
        loadingSound: false,
        soundsLoaded: false
      });

      // 初始化音频实例
      await this.loadSounds();
      
      console.log('[Metronome] 音频池初始化成功');
    } catch (error) {
      console.error('[Metronome] 初始化音频池失败:', error);
      
      // 重置状态
      this.setData({ 
        loadingSound: false,
        soundsLoaded: false
      });

      // 显示错误提示
      wx.showToast({
        title: '音频初始化失败',
        icon: 'none',
        duration: 2000
      });

      // 尝试使用默认音色
      if (this.data.currentSound !== 'metronome_click') {
        console.log('[Metronome] 尝试切换到默认音色');
        this.setData({ currentSound: 'metronome_click' }, () => {
          this.loadSounds().catch(err => {
            console.error('[Metronome] 加载默认音色也失败:', err);
          });
        });
      }
    }
  },

  destroyAudioPool() {
    console.log('[Metronome] 销毁音频池');
    ['normal', 'accent'].forEach(type => {
      AudioPreloadManager.cleanup(type);
    });
  },

  loadSounds() {
    return new Promise((resolve, reject) => {
      // 如果已经在加载中，返回错误
    if (this.data.loadingSound) {
        console.log('[Metronome] 音频正在加载中，等待当前加载完成');
        reject(new Error('音频正在加载中'));
        return;
      }

      // 如果音频已经加载完成且没有变化，直接返回
      if (this.data.soundsLoaded && audioPool.normal.current && audioPool.accent.current) {
        console.log('[Metronome] 音频已加载，无需重新加载');
        resolve();
      return;
    }

    const currentSound = this.data.currentSound;
    console.log('[Metronome] 开始加载音频文件:', currentSound);
    
      this.setData({ 
        loadingSound: true,
        soundsLoaded: false
      });
      
      let loadedCount = 0;
      const loadTimeout = setTimeout(() => {
        if (this.data.loadingSound) {
          this.setData({ loadingSound: false });
          reject(new Error('音频加载超时'));
        }
      }, 5000); // 5秒超时

      const finishLoading = () => {
        loadedCount++;
        if (loadedCount === 2) {
          clearTimeout(loadTimeout);
          this.setData({
            soundsLoaded: true,
            loadingSound: false
          });
          resolve();
        }
      };

      const handleError = (type, error) => {
        console.error(`[Metronome] ${type}音频加载失败:`, error);
        clearTimeout(loadTimeout);
        this.setData({ 
          loadingSound: false,
          soundsLoaded: false
        });
        reject(error);
      };

      try {
        // 创建新的音频实例
        const normalAudio = wx.createInnerAudioContext({ useWebAudioImplement: true });
        const accentAudio = wx.createInnerAudioContext({ useWebAudioImplement: true });

        normalAudio.src = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_soft.mp3`;
        accentAudio.src = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_hard.mp3`;

        // iOS音频优化设置
        normalAudio.autoplay = false;
        accentAudio.autoplay = false;
        normalAudio.obeyMuteSwitch = false;
        accentAudio.obeyMuteSwitch = false;

        normalAudio.onCanplay(() => {
          console.log('[Metronome] normal音频加载成功');
          finishLoading();
        });

        accentAudio.onCanplay(() => {
          console.log('[Metronome] accent音频加载成功');
          finishLoading();
        });

        normalAudio.onError((err) => handleError('normal', err));
        accentAudio.onError((err) => handleError('accent', err));

        // 更新音频池
        if (audioPool.normal.current) {
          audioPool.normal.current.destroy();
        }
        if (audioPool.accent.current) {
          audioPool.accent.current.destroy();
        }

        audioPool.normal.current = normalAudio;
        audioPool.accent.current = accentAudio;
            
          } catch (error) {
        handleError('初始化', error);
      }
    });
  },

  // 预加载下一个音色
  preloadNextSound() {
    const currentIndex = this.data.sounds.findIndex(s => s.id === this.data.currentSound);
    if (currentIndex === -1) return;

    const nextSound = this.data.sounds[(currentIndex + 1) % this.data.sounds.length];
    if (!nextSound) return;

    console.log('[Metronome] 预加载下一个音色:', nextSound.id);
    
    Promise.all([
      AudioPreloadManager.preloadAudio('normal', nextSound.id),
      AudioPreloadManager.preloadAudio('accent', nextSound.id)
    ]).then(([normalAudio, accentAudio]) => {
      audioPool.normal.next = normalAudio;
      audioPool.accent.next = accentAudio;
      console.log('[Metronome] 下一个音色预加载完成:', nextSound.id);
    }).catch(error => {
      console.error('[Metronome] 预加载下一个音色失败:', error);
    });
  },

  // 修改 playBeatSound 方法
  playBeatSound(beatType) {
    try {
      const audio = audioPool[beatType === 'accent' ? 'accent' : 'normal'].current;
      if (!audio) return;

      // 使用克隆实例进行播放，避免重复播放的问题
      const playInstance = wx.createInnerAudioContext({ useWebAudioImplement: true });
      playInstance.src = audio.src;
      playInstance.volume = 1;
      
      // 播放完成后自动销毁
      playInstance.onEnded(() => {
        playInstance.destroy();
      });
      
      playInstance.onError((err) => {
        console.error('[Metronome] 播放音频失败:', err);
        playInstance.destroy();
      });

      // iOS音频优化：先停止再播放
          setTimeout(() => {
        playInstance.play();
      }, 0);

    } catch (error) {
      console.error('[Metronome] 播放音频失败:', error);
    }
  },

  // 添加 Tap Tempo 处理方法
  handleTapTempo() {
    const now = Date.now();
    
    // 检查是否需要重置
    if (this.data.tapTempoTimeout) {
      clearTimeout(this.data.tapTempoTimeout);
    }

    // 设置重置定时器
    const resetTimeout = setTimeout(() => {
      this.resetTapTempo();
    }, this.data.tapTempoResetDelay);

    // 获取当前tap times数组
    let tapTimes = [...this.data.tapTempoTimes];
    const lastTap = tapTimes[tapTimes.length - 1];

    // 检查点击间隔是否有效
    if (lastTap) {
      const interval = now - lastTap;
      if (interval < this.data.tapTempoMinInterval || interval > this.data.tapTempoMaxInterval) {
        this.resetTapTempo();
        tapTimes = [now];
      }
    }

    // 添加新的时间戳
    tapTimes.push(now);

    // 保持数组在最大采样范围内
    if (tapTimes.length > this.data.tapTempoMaxSamples) {
      tapTimes = tapTimes.slice(-this.data.tapTempoMaxSamples);
    }

    // 计算平均间隔并更新BPM
    if (tapTimes.length > 1) {
      const intervals = [];
      for (let i = 1; i < tapTimes.length; i++) {
        intervals.push(tapTimes[i] - tapTimes[i - 1]);
      }

      // 计算平均间隔
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      
      // 将间隔转换为BPM (60000ms / interval = BPM)
      const newBpm = Math.round(60000 / avgInterval);
      
      // 确保BPM在有效范围内
      const clampedBpm = Math.min(Math.max(newBpm, this.data.minBpm), this.data.maxBpm);

      // 更新BPM
    this.setData({ 
        bpm: clampedBpm,
        tapTempoTimes: tapTimes,
        tapTempoCount: tapTimes.length,
        tapTempoTimeout: resetTimeout
      });

      // 添加触感反馈
      wx.vibrateShort({ type: 'light' });

    } else {
      // 第一次点击
      this.setData({
        tapTempoTimes: tapTimes,
        tapTempoCount: tapTimes.length,
        tapTempoTimeout: resetTimeout
      });
    }
  },

  // 重置 Tap Tempo 状态
  resetTapTempo() {
    if (this.data.tapTempoTimeout) {
      clearTimeout(this.data.tapTempoTimeout);
    }
    
    this.setData({
      tapTempoTimes: [],
      tapTempoCount: 0,
      tapTempoTimeout: null
    });
  },

  // 修改圆圈点击处理方法
  onCircleTap() {
    try {
    const now = Date.now();
      
      // 如果启用了tap tempo，则处理tap tempo
      if (this.data.tapTempoEnabled) {
        this.handleTapTempo();
        return;
      }
      
      // 原有的双击播放逻辑
    if (now - lastTapTime < DOUBLE_TAP_DELAY) {
      this.togglePlay();
        lastTapTime = 0;
    } else {
      lastTapTime = now;
      }
    } catch (error) {
      console.error('[Metronome] 圆圈点击处理出错:', error);
      lastTapTime = 0;
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

      // 更新动画时间
      this.updateBeatDuration();

      console.log('[Metronome] 开始播放节拍器, BPM:', this.data.bpm);
      let currentBeat = 0;
      
      // 优化BPM计算逻辑
      const calculateBeatDuration = () => {
        // 基础BPM到毫秒的转换
        const baseDuration = 60000 / this.data.bpm;
        
        // 解析拍号
        const [beatsPerMeasure, beatValue] = this.data.timeSignature.split('/').map(Number);
        
        // 根据拍子类型调整持续时间
        switch (beatValue) {
          case 8:
            // 八分音符的时值是四分音符的1/2
            return baseDuration / 2;
          case 16:
            // 十六分音符的时值是四分音符的1/4
            return baseDuration / 4;
          case 2:
            // 二分音符的时值是四分音符的2倍
            return baseDuration * 2;
          default: // 4（四分音符）
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
      }, () => {
        // BPM 变化时更新动画时间
      if (this.data.isPlaying) {
          this.updateBeatDuration();
        }
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
      if (wasPlaying) {
        this.stopMetronome();
      }

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
        currentBeat: 0,
        isCustomTimeSignature: false
      }, () => {
        // 保存拍号设置
        try {
          // 保存标准拍号
          wx.setStorageSync('metronome_time_signature', pattern);
          
          // 清除自定义拍号数据
          wx.removeStorageSync('metronome_custom_time_signature');
        } catch (err) {
          console.error('[Metronome] 保存拍号设置失败:', err);
        }
        
        // 添加延迟确保UI更新完成
        setTimeout(() => {
          if (wasPlaying) {
          this.startMetronome();
        }
        }, 50);
      });

    } catch (error) {
      console.error('[Metronome] 切换拍号出错:', error);
      // 显示错误提示
      wx.showToast({
        title: '切换拍号出错',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // 显示自定义拍号弹窗
  showCustomTimeSignatureModal() {
    // 初始化自定义拍号的默认值
    const currentBeatsCount = this.data.isCustomTimeSignature ? 
      this.data.customBeatsCount : 
      parseInt(this.data.timeSignature.split('/')[0]);
    
    const currentBeatValue = this.data.isCustomTimeSignature ? 
      this.data.customBeatValue : 
      parseInt(this.data.timeSignature.split('/')[1]);
    
    // 初始化重音设置
    let emphasisArray = Array(currentBeatsCount).fill(false);
    emphasisArray[0] = true; // 默认第一拍为重音
    
    // 如果是当前自定义拍号，保留已有的重音设置
    if (this.data.isCustomTimeSignature && this.data.customBeatsEmphasis.length === currentBeatsCount) {
      emphasisArray = [...this.data.customBeatsEmphasis];
    } else {
      // 根据常见的拍号规律设置默认重音
      if (currentBeatsCount % 3 === 0) {
        // 3拍子的规律
        for (let i = 0; i < currentBeatsCount; i++) {
          emphasisArray[i] = i % 3 === 0;
        }
      } else if (currentBeatsCount % 4 === 0) {
        // 4拍子的规律
        for (let i = 0; i < currentBeatsCount; i++) {
          emphasisArray[i] = i % 4 === 0;
          // 4/4, 12/8等拍号通常在第三拍也有弱重音
          if (currentBeatsCount >= 4 && i % 4 === 2) {
            emphasisArray[i] = true;
          }
        }
      } else if (currentBeatsCount % 2 === 0) {
        // 2拍子的规律
        for (let i = 0; i < currentBeatsCount; i++) {
          emphasisArray[i] = i % 2 === 0;
        }
      }
    }
    
    this.setData({
      showCustomModal: true,
      customBeatsCount: currentBeatsCount,
      customBeatValue: currentBeatValue,
      customBeatsEmphasis: emphasisArray
    });
  },
  
  // 关闭自定义拍号弹窗
  closeCustomModal() {
    this.setData({
      showCustomModal: false
    });
  },
  
  // 阻止事件冒泡
  stopPropagation(e) {
    // 阻止事件向上冒泡
  },
  
  // 增加拍子数量
  increaseBeatsCount() {
    if (this.data.customBeatsCount < this.data.maxBeatsCount) {
      const newCount = this.data.customBeatsCount + 1;
      const newEmphasis = [...this.data.customBeatsEmphasis];
      // 添加新的非重音拍
      newEmphasis.push(false);
      
      this.setData({
        customBeatsCount: newCount,
        customBeatsEmphasis: newEmphasis
      });
    } else {
      wx.showToast({
        title: `最多支持${this.data.maxBeatsCount}拍`,
        icon: 'none',
        duration: 1500
      });
    }
  },
  
  // 减少拍子数量
  decreaseBeatsCount() {
    if (this.data.customBeatsCount > this.data.minBeatsCount) {
      const newCount = this.data.customBeatsCount - 1;
      const newEmphasis = this.data.customBeatsEmphasis.slice(0, newCount);
      
      this.setData({
        customBeatsCount: newCount,
        customBeatsEmphasis: newEmphasis
      });
    } else {
      wx.showToast({
        title: `至少需要${this.data.minBeatsCount}拍`,
        icon: 'none',
        duration: 1500
      });
    }
  },
  
  // 选择拍子类型
  selectBeatValue(e) {
    const value = parseInt(e.currentTarget.dataset.value);
    this.setData({
      customBeatValue: value
    });
  },
  
  // 切换重音设置
  toggleEmphasis(e) {
    const index = e.currentTarget.dataset.index;
    const newEmphasis = [...this.data.customBeatsEmphasis];
    newEmphasis[index] = !newEmphasis[index];
    
    this.setData({
      customBeatsEmphasis: newEmphasis
    });
  },
  
  // 应用自定义拍号
  applyCustomTimeSignature() {
    try {
      const { customBeatsCount, customBeatValue, customBeatsEmphasis } = this.data;
      
      // 验证数据有效性
      if (customBeatsCount < this.data.minBeatsCount || customBeatsCount > this.data.maxBeatsCount) {
        throw new Error(`拍子数量必须在${this.data.minBeatsCount}到${this.data.maxBeatsCount}之间`);
      }
      
      const wasPlaying = this.data.isPlaying;
      if (wasPlaying) {
        this.stopMetronome();
      }
      
      // 创建新的拍子数组
      const beats = [];
      for (let i = 0; i < customBeatsCount; i++) {
        beats.push({
          type: customBeatsEmphasis[i] ? 'accent' : 'normal',
          active: false
        });
      }
      
      // 构建自定义拍号字符串
      const customTimeSignature = `${customBeatsCount}/${customBeatValue}`;
      
      // 更新状态
      this.setData({
        timeSignature: customTimeSignature,
        customTimeSignature: customTimeSignature,
        isCustomTimeSignature: true,
        beats,
        currentBeat: 0,
        showCustomModal: false
      }, () => {
        // 保存自定义拍号设置
        try {
          // 保存拍号标识
          wx.setStorageSync('metronome_time_signature', customTimeSignature);
          
          // 保存完整自定义拍号数据
          const customData = {
            timeSignature: customTimeSignature,
            beats: beats,
            beatsCount: customBeatsCount,
            beatValue: customBeatValue,
            emphasis: customBeatsEmphasis
          };
          
          wx.setStorageSync('metronome_custom_time_signature', JSON.stringify(customData));
        } catch (err) {
          console.error('[Metronome] 保存自定义拍号设置失败:', err);
        }
        
        // 添加延迟确保UI更新完成
        setTimeout(() => {
          if (wasPlaying) {
            this.startMetronome();
          }
        }, 50);
      });
    } catch (error) {
      console.error('[Metronome] 应用自定义拍号出错:', error);
      wx.showToast({
        title: error.message || '应用自定义拍号出错',
        icon: 'none',
        duration: 2000
      });
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
    console.log('[Metronome] 显示音色选择器');
    console.log('[Metronome] 当前音色数据:', {
      sounds: this.data.sounds,
      categories: this.data.soundCategories,
      currentSound: this.data.currentSound
    });
    this.setData({
      showSoundPicker: true
    }, () => {
      console.log('[Metronome] 音色选择器状态已更新:', this.data.showSoundPicker);
    });
  },

  // 关闭音色选择器
  onSoundPickerClose() {
    console.log('[Metronome] 关闭音色选择器');
    this.setData({
      showSoundPicker: false
    });
  },

  // 选择音色
  onSoundSelect(e) {
    const { soundId, soundFiles } = e.detail;
    console.log('[Metronome] 选择音色:', soundId, '音频文件:', soundFiles);
    
    if (!soundId || !soundFiles) {
      console.error('[Metronome] Invalid sound data received');
      return;
    }

    // 防止重复切换
    if (soundId === this.data.currentSound) {
      return;
    }

    const wasPlaying = this.data.isPlaying;
    if (wasPlaying) {
      this.stopMetronome();
    }

    // 更新当前音色
    this.setData({
      currentSound: soundId,
      soundsLoaded: false
    }, () => {
      // 更新音色名称
      this.updateCurrentSoundName();

      // 创建新的音频实例
      const normalAudio = wx.createInnerAudioContext();
      const accentAudio = wx.createInnerAudioContext();
      
      normalAudio.src = soundFiles.normal;
      accentAudio.src = soundFiles.accent;
      
      // 等待音频加载完成
      let loadedCount = 0;
      const onLoad = () => {
        loadedCount++;
        if (loadedCount === 2) {
          // 更新音频池
          if (audioPool.normal.current) {
            audioPool.normal.current.destroy();
          }
          if (audioPool.accent.current) {
            audioPool.accent.current.destroy();
          }
          audioPool.normal.current = normalAudio;
          audioPool.accent.current = accentAudio;
          
          this.setData({ 
            soundsLoaded: true,
            loadingSound: false
          }, () => {
            // 如果之前在播放，恢复播放
            if (wasPlaying) {
              this.startMetronome();
            }
          });
        }
      };
      
      normalAudio.onCanplay(() => {
        console.log('[Metronome] normal音频加载成功');
        onLoad();
      });
      
      accentAudio.onCanplay(() => {
        console.log('[Metronome] accent音频加载成功');
        onLoad();
      });
      
      const handleError = (err) => {
        console.error('[Metronome] 音频加载失败:', err);
        this.setData({ 
          loadingSound: false,
          soundsLoaded: false
        });
        wx.showToast({
          title: '音色切换失败',
          icon: 'none'
        });
      };
      
      normalAudio.onError(handleError);
      accentAudio.onError(handleError);
    });
  },

  // 试听音色
  onSoundTest(e) {
    const { soundId, testing } = e.detail;
    console.log('[Metronome] 试听音色:', soundId, '状态:', testing);
    
    if (!soundId) {
      console.error('[Metronome] Invalid soundId received for testing');
      return;
    }

    if (testing) {
      this.playTestSound(soundId);
    } else {
      this.stopTestSound();
    }
  },

  // 播放试听音色
  playTestSound(soundId) {
    const audioPath = `wxfile://usr/sounds/${soundId}_soft.mp3`;
    console.log('[Metronome] 播放试听音色:', audioPath);
    
    const audio = wx.createInnerAudioContext();
    audio.src = audioPath;
    
    audio.onPlay(() => {
      console.log('[Metronome] 试听开始');
    });
    
    audio.onEnded(() => {
      console.log('[Metronome] 试听结束');
      audio.destroy();
    });
    
    audio.onError((err) => {
      console.error('[Metronome] 试听失败:', err);
      audio.destroy();
      wx.showToast({
        title: '试听失败',
        icon: 'none'
      });
    });
    
    audio.play();
  },

  // 停止试听音色
  stopTestSound() {
    // 如果有正在播放的试听音色，停止它
    if (this.testAudio) {
      this.testAudio.stop();
      this.testAudio.destroy();
      this.testAudio = null;
    }
  },

  // 加载音色
  loadSound(soundId) {
    console.log('[Metronome] 开始加载音频文件:', soundId);
    
    const audioPath = {
      normal: `wxfile://usr/sounds/${soundId}_soft.mp3`,
      accent: `wxfile://usr/sounds/${soundId}_hard.mp3`
    };
    
    console.log('[Metronome] 音频文件路径:', audioPath);
    
    return new Promise((resolve, reject) => {
      // 设置加载状态
      this.setData({ loadingSound: true });
      
      // 创建音频上下文
      const normalAudio = wx.createInnerAudioContext();
      const accentAudio = wx.createInnerAudioContext();
      
      normalAudio.src = audioPath.normal;
      accentAudio.src = audioPath.accent;
      
      let loadedCount = 0;
      const onLoad = () => {
        loadedCount++;
        if (loadedCount === 2) {
          this.setData({ 
            loadingSound: false,
            soundsLoaded: true
          });
          resolve();
        }
      };
      
      const onError = (err) => {
        console.error('[Metronome] 音频加载失败:', err);
        this.setData({ loadingSound: false });
        reject(err);
      };
      
      normalAudio.onCanplay(() => {
        console.log('[Metronome] normal音频加载成功');
        onLoad();
      });
      
      accentAudio.onCanplay(() => {
        console.log('[Metronome] accent音频加载成功');
        onLoad();
      });
      
      normalAudio.onError((err) => {
        console.error('[Metronome] normal音频加载失败:', err);
        onError(err);
      });
      
      accentAudio.onError((err) => {
        console.error('[Metronome] accent音频加载失败:', err);
        onError(err);
      });
    });
  },

  // 修改 handleAudioError 方法
  async handleAudioError(message) {
    console.error('[Metronome] 音频错误:', message);
    
    try {
      // 检查并重新复制音频文件
      await AudioFileManager.copyAllAudioFiles(this.data.sounds);
      
      wx.showToast({
        title: message,
        icon: 'none',
        duration: 2000
      });
      
      this.setData({ 
        soundsLoaded: false,
        loadingSound: false
      });
    } catch (error) {
      console.error('[Metronome] 处理音频错误失败:', error);
    }
  },

  // 切换 Tap Tempo 模式
  toggleTapTempo() {
    const newState = !this.data.tapTempoEnabled;
    
    this.setData({
      tapTempoEnabled: newState
    });

    if (!newState) {
      this.resetTapTempo();
    }

    // 添加触感反馈
    wx.vibrateShort({
      type: newState ? 'medium' : 'light'
    });

    // 显示提示
    wx.showToast({
      title: newState ? '点击BPM球测速' : 'Tap tempo模式已关闭',
      icon: 'none',
      duration: 1500
    });
  },

  // 更新节拍动画时间
  updateBeatDuration() {
    try {
      const beatDuration = Math.round(60000 / this.data.bpm);
      // 更新CSS变量
      const container = wx.createSelectorQuery().select('.container');
      container.fields({ node: true, size: true }).exec((res) => {
        if (res[0] && res[0].node) {
          res[0].node.style.setProperty('--beat-duration', `${beatDuration}ms`);
        }
      });
    } catch (error) {
      console.error('[Metronome] 更新动画时间出错:', error);
    }
  },

  // 在BPM改变时更新动画时间
  onBpmChange(newBpm) {
    this.setData({ bpm: newBpm }, () => {
      if (this.data.isPlaying) {
        this.updateBeatDuration();
      }
    });
  },

  // BPM 控制相关方法
  decreaseBpm() {
    const newBpm = Math.max(this.data.minBpm, this.data.bpm - 1);
    this.updateBpm(newBpm);
  },

  increaseBpm() {
    const newBpm = Math.min(this.data.maxBpm, this.data.bpm + 1);
    this.updateBpm(newBpm);
  },

  startDecreaseBpm() {
    this.startBpmChange('decrease');
  },

  startIncreaseBpm() {
    this.startBpmChange('increase');
  },

  startBpmChange(direction) {
    // 清除可能存在的定时器
    this.stopBpmChange();
    
    // 首次变化延迟较短
    this.data.bpmChangeTimeout = setTimeout(() => {
      this.data.bpmChangeInterval = setInterval(() => {
        if (direction === 'decrease') {
          this.decreaseBpm();
        } else {
          this.increaseBpm();
        }
      }, 50); // 持续变化的间隔
    }, 300); // 首次变化前的延迟
  },

  stopBpmChange() {
    if (this.data.bpmChangeInterval) {
      clearInterval(this.data.bpmChangeInterval);
      this.data.bpmChangeInterval = null;
    }
    if (this.data.bpmChangeTimeout) {
      clearTimeout(this.data.bpmChangeTimeout);
      this.data.bpmChangeTimeout = null;
    }
  },

  // 滑动条相关方法
  onSliderTouchStart(e) {
    const touch = e.touches[0];
    const slider = e.currentTarget;
    const query = wx.createSelectorQuery();
    
    query.select('.bpm-slider').boundingClientRect(rect => {
      if (!rect) return;
      
      const position = (touch.clientX - rect.left) / rect.width;
      const newBpm = Math.round(this.data.minBpm + position * (this.data.maxBpm - this.data.minBpm));
      
      this.setData({
        isDragging: true,
        dragStartBpm: this.data.bpm
      });
      
      this.updateBpm(Math.min(Math.max(newBpm, this.data.minBpm), this.data.maxBpm));
    }).exec();
  },

  onSliderTouchMove(e) {
    if (!this.data.isDragging) return;
    
    const touch = e.touches[0];
    const slider = e.currentTarget;
    const query = wx.createSelectorQuery();
    
    query.select('.bpm-slider').boundingClientRect(rect => {
      if (!rect) return;
      
      const position = (touch.clientX - rect.left) / rect.width;
      const newBpm = Math.round(this.data.minBpm + position * (this.data.maxBpm - this.data.minBpm));
      const clampedBpm = Math.min(Math.max(newBpm, this.data.minBpm), this.data.maxBpm);
      
      // 检查是否需要吸附
      const nearestSnap = this.findNearestSnapPoint(clampedBpm);
      if (nearestSnap) {
        const now = Date.now();
        if (now - this.data.lastSnapTime > this.data.snapCooldown) {
          this.setData({
            isSnapping: true,
            lastSnapTime: now
          });
          
          // 触发震动反馈
          wx.vibrateShort({
            type: 'medium'
          });
          
          // 更新BPM到吸附点
          this.updateBpm(nearestSnap.value);
          
          // 移除snapping状态
          setTimeout(() => {
            this.setData({ isSnapping: false });
          }, this.data.snapAnimationDuration);
        }
      } else {
        this.updateBpm(clampedBpm);
      }
      
      // 更新吸附点状态
      this.updateSnapPoints(this.data.bpm);
    }).exec();
  },

  onSliderTouchEnd() {
    if (!this.data.isDragging) return;
    
    // 重置状态
    this.setData({ 
      isDragging: false,
      isSnapping: false,
      dragStartBpm: 0
    });
    
    // 检查最终位置是否需要吸附
    const nearestSnap = this.findNearestSnapPoint(this.data.bpm);
    if (nearestSnap) {
      this.setData({ isSnapping: true });
      
      // 触发震动反馈
      wx.vibrateShort({
        type: 'medium'
      });
      
      // 更新BPM到吸附点
      this.updateBpm(nearestSnap.value);
      
      // 移除snapping状态
      setTimeout(() => {
        this.setData({ isSnapping: false });
      }, this.data.snapAnimationDuration);
    }
  },

  // 计算最近的吸附点
  findNearestSnapPoint(bpm) {
    let nearest = null;
    let minDiff = Infinity;
    
    this.data.snapPoints.forEach(point => {
      const diff = Math.abs(point.value - bpm);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = point;
      }
    });
    
    return minDiff <= this.data.snapThreshold ? nearest : null;
  },

  // 更新吸附点状态
  updateSnapPoints(currentBpm) {
    const snapPoints = this.data.snapPoints.map(point => ({
      ...point,
      active: Math.abs(point.value - currentBpm) <= this.data.snapThreshold
    }));
    this.setData({ snapPoints });
  },

  // 更新 BPM
  updateBpm(newBpm) {
    if (newBpm === this.data.bpm) return;
    
    this.setData({ bpm: newBpm });
    
    // 如果正在播放，需要更新节拍器
    if (this.data.isPlaying) {
      this.updateBeatDuration();
    }
  },

  // 切换菜单展开状态
  toggleMenu() {
    this.setData({
      isMenuExpanded: !this.data.isMenuExpanded
    });
    
    // 添加触感反馈
    wx.vibrateShort({
      type: 'light'
    });
  },

  // 处理设置按钮点击
  onSettingsTap() {
    this.setData({
      isMenuExpanded: false
    });
    
    wx.navigateTo({
      url: '/pages/settings/index'
    });
  },

  // 处理关于按钮点击
  onAboutTap() {
    this.setData({
      isMenuExpanded: false
    });
    
    wx.navigateTo({
      url: '/pages/about/index'
    });
  },
}); 