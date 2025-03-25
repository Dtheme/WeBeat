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
          `sounds/${fileName}`,  // 修改这里：使用相对路径
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
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_${type === 'accent' ? 'hard' : 'soft'}.mp3`;
      
      try {
        // 先检查文件是否存在
        fs.accessSync(filePath);
        
        const audio = wx.createInnerAudioContext();
        audio.src = filePath;
        
        // iOS音频优化设置
        audio.autoplay = false;
        audio.obeyMuteSwitch = false;
        audio.volume = 1.0;

        let isResolved = false;
        let loadTimeout = null;
        
        const cleanup = () => {
          if (loadTimeout) {
            clearTimeout(loadTimeout);
            loadTimeout = null;
          }
        };
        
        const handleSuccess = () => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            
            // 预热音频系统
            audio.volume = 0;
            audio.play();
            
            setTimeout(() => {
              audio.stop();
              audio.volume = 1;
              console.log(`[Metronome] 音频预加载成功: ${type}`);
              resolve(audio);
            }, 100);
          }
        };

        const handleError = (err) => {
          if (!isResolved) {
            isResolved = true;
            cleanup();
            console.error(`[Metronome] 预加载音频失败 ${type}:`, err);
            reject(err);
          }
        };

        // 设置加载超时
        loadTimeout = setTimeout(() => {
          handleError(new Error('音频预加载超时'));
        }, 5000);

        audio.onCanplay(() => {
          handleSuccess();
        });

        audio.onError((err) => {
          handleError(err);
        });

      } catch (error) {
        console.error(`[Metronome] 音频文件访问失败 ${type}:`, error);
        reject(error);
      }
    });
  },

  // 切换到预加载的音频
  switchToPreloaded(type) {
    if (audioPool[type].next) {
      // 销毁当前音频
      if (audioPool[type].current) {
        try {
          audioPool[type].current.destroy();
        } catch (error) {
          console.error(`[Metronome] 销毁音频失败 ${type}:`, error);
        }
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
        try {
          audioPool[type][slot].destroy();
        } catch (error) {
          console.error(`[Metronome] 清理音频失败 ${type}.${slot}:`, error);
        }
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
    this.showToast({
      title: '发生错误，已停止播放',
      icon: 'error',
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
    this.showToast({
      title: '发生异步错误，已停止播放',
      icon: 'error',
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
    maxBeatsCount: 16,
    // 音色相关
    sounds: [
      // 基础音色
      { id: 'metronome_click', name: '节拍器', category: 'basic', description: '标准节拍器音色' },
      { id: 'beep', name: '蜂鸣', category: 'basic', description: '简单清晰的电子音' },
      { id: 'click', name: '点击', category: 'basic', description: '轻快的点击声' },
      { id: 'clock_tick', name: '时钟', category: 'basic', description: '时钟滴答声' },
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
    
    // 节奏型选择器相关
    showRhythmPicker: false,
    currentRhythm: null,
    rhythmIntensity: 0.5, // 默认强度为50%（0.5）
    
    // 节奏型分类
    rhythmCategories: [
      { id: 'basic', name: 'Basic', icon: 'icon-rhythm', description: '基础节奏型，适合初学者和简单练习' },
      { id: 'rock', name: 'Rock', icon: 'icon-guitar', description: '摇滚音乐中常见的节奏模式' },
      { id: 'jazz', name: 'Jazz', icon: 'icon-saxophone', description: '爵士音乐特有的节奏感，注重韵律变化' },
      { id: 'latin', name: 'Latin', icon: 'icon-drum', description: '拉丁音乐风格的节奏型，热情有活力' },
      { id: 'funk', name: 'Funk', icon: 'icon-bass', description: '强调节拍的切分与律动感' },
      { id: 'swing', name: 'Swing', icon: 'icon-music', description: '摇摆节奏，可调整强度' },
      { id: 'shuffle', name: 'Shuffle', icon: 'icon-dance', description: '舞曲风格的节奏，可调整强度' }
    ],

    // 节奏型列表
    rhythmPatterns: [
      // 基础节奏
      { 
        id: 'straight', 
        name: 'Straight', 
        category: 'basic', 
        pattern: [1, 0, 0, 0], 
        timeSignature: '4/4',
        description: '标准4/4拍，第一拍重音' 
      },
      { 
        id: 'downbeat', 
        name: 'Downbeat', 
        category: 'basic', 
        pattern: [1, 0, 1, 0], 
        timeSignature: '4/4',
        description: '强调每个强拍' 
      },
      { 
        id: 'upbeat', 
        name: 'Upbeat', 
        category: 'basic', 
        pattern: [0, 1, 0, 1], 
        timeSignature: '4/4',
        description: '强调每个弱拍' 
      },

      // 摇滚节奏
      { 
        id: 'rock_basic', 
        name: 'Basic Rock', 
        category: 'rock', 
        pattern: [1, 0, 0, 0], 
        timeSignature: '4/4',
        description: '基础摇滚节奏' 
      },
      { 
        id: 'rock_alt', 
        name: 'Alt Rock', 
        category: 'rock', 
        pattern: [1, 0, 0, 1, 1, 0, 1, 0], 
        timeSignature: '4/4',
        description: '另类摇滚，快速的 1, 3, 4 拍节奏' 
      },
      { 
        id: 'power_rock', 
        name: 'Power Rock', 
        category: 'rock', 
        pattern: [1, 0, 1, 1, 1, 0, 1, 1], 
        timeSignature: '4/4',
        description: '强力摇滚，适用于硬摇滚和金属' 
      },

      // 爵士节奏
      { 
        id: 'jazz_ride', 
        name: 'Jazz Ride', 
        category: 'jazz', 
        pattern: [1, 0, 0, 1, 0, 1, 0, 1], 
        timeSignature: '4/4',
        description: '经典的 Swing 骑镲节奏，强调 1 和 3 拍' 
      },
      { 
        id: 'bebop', 
        name: 'Bebop', 
        category: 'jazz', 
        pattern: [1, 0, 1, 0, 0, 1, 0, 1], 
        timeSignature: '4/4',
        description: '自由切分的 Bebop 节奏，强调 Syncopation' 
      },

      // 拉丁节奏
      { 
        id: 'bossa_nova', 
        name: 'Bossa Nova', 
        category: 'latin', 
        pattern: [1, 0, 0, 1, 0, 1, 0, 0], 
        timeSignature: '4/4',
        description: '经典的 Bossa Nova 节奏，强调 1 和 4 拍' 
      },
      { 
        id: 'samba', 
        name: 'Samba', 
        category: 'latin', 
        pattern: [1, 0, 1, 0, 0, 1, 0, 1], 
        timeSignature: '4/4',
        description: '典型桑巴切分节奏，强调 Swing 感' 
      },
      { 
        id: 'rumba', 
        name: 'Rumba', 
        category: 'latin', 
        pattern: [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0], 
        timeSignature: '4/4',
        description: 'Afro-Cuban Rumba 节奏，基于 3-2 Clave' 
      },   

      // 放克节奏
      { 
        id: 'funk_basic', 
        name: 'Basic Funk', 
        category: 'funk', 
        pattern: [1, 0, 1, 0, 0, 1, 0, 0], 
        timeSignature: '4/4',
        description: '基础放克节奏，Kick 在 1, 3, 7 拍，Snare 在 5, 9, 13 拍' 
      },
      { 
        id: 'funk_syncopated', 
        name: 'Syncopated Funk', 
        category: 'funk', 
        pattern: [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 
        timeSignature: '4/4',
        description: '更复杂的放克切分节奏，Kick 主要在 "&" 和 "a" 上' 
      },

      // Swing 节奏 - 强度可调
      { 
        id: 'swing_basic', 
        name: 'Basic Swing', 
        category: 'swing', 
        pattern: [1, 0, 0, 1], 
        timeSignature: '4/4',
        defaultBeats: [
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false }
        ],
        description: '基础摇摆节奏，强调 2、4 拍' 
      },
      { 
        id: 'swing_waltz', 
        name: 'Swing Waltz', 
        category: 'swing', 
        pattern: [1, 0, 0], 
        timeSignature: '3/4',
        defaultBeats: [
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false }
        ],
        description: '3/4 拍摇摆华尔兹' 
      },
      { 
        id: 'swing_compound', 
        name: 'Compound Swing', 
        category: 'swing', 
        pattern: [1, 0, 0, 1, 0, 0], 
        timeSignature: '6/8',
        defaultBeats: [
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false }
        ],
        description: '6/8 拍复合摇摆节奏' 
      },

      // Shuffle 节奏 - 强度可调
      { 
        id: 'shuffle_basic', 
        name: 'Basic Shuffle', 
        category: 'shuffle', 
        pattern: [1, 0, 0, 1], 
        timeSignature: '4/4',
        defaultBeats: [
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false }
        ],
        description: '基础舞曲节奏' 
      },
      { 
        id: 'shuffle_blues', 
        name: 'Blues Shuffle', 
        category: 'shuffle', 
        pattern: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 
        timeSignature: '12/8',
        defaultBeats: [
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false },
          { type: 'accent', active: false },
          { type: 'normal', active: false },
          { type: 'normal', active: false }
        ],
        description: '布鲁斯舞曲节奏' 
      }
    ],

    toastConfig: {
      show: false,
      title: '',
      icon: 'none',
      duration: 2000
    }
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
    
    // 加载保存的节奏型设置
    wx.getStorage({
      key: 'currentRhythm',
      success: (res) => {
        if (res.data) {
          this.setData({
            currentRhythm: res.data
          });
        }
      }
    });
    
    // 加载保存的节奏强度
    wx.getStorage({
      key: 'rhythmIntensity',
      success: (res) => {
        if (res.data !== undefined) {
          this.setData({
            rhythmIntensity: res.data
          });
        }
      }
    });
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
      // 确保音频目录存在
      await AudioFileManager.ensureAudioDirectory();
      
      // 确保音频文件存在
      console.log('[Metronome] 开始复制音频文件');
      await AudioFileManager.copyAllAudioFiles(this.data.sounds);
      
      // 重置音频状态
      this.setData({ 
        loadingSound: false,
        soundsLoaded: false
      });

      // 初始化音频实例
      console.log('[Metronome] 开始加载音频');
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
      this.showToast({
        title: '音频初始化失败，正在重试',
        icon: 'error',
        duration: 2000
      });

      // 延迟后重试
      setTimeout(() => {
        console.log('[Metronome] 重试初始化音频池');
        // 尝试使用默认音色
        if (this.data.currentSound !== 'metronome_click') {
          this.setData({ currentSound: 'metronome_click' }, () => {
            this.loadSounds().catch(err => {
              console.error('[Metronome] 加载默认音色失败:', err);
              this.showToast({
                title: '音频加载失败，请重启小程序',
                icon: 'error',
                duration: 3000
              });
            });
          });
        }
      }, 1000);
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

      // 验证文件是否存在
      const fs = wx.getFileSystemManager();
      const normalPath = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_soft.mp3`;
      const accentPath = `${wx.env.USER_DATA_PATH}/sounds/${currentSound}_hard.mp3`;

      try {
        // 检查文件是否存在
        fs.accessSync(normalPath);
        fs.accessSync(accentPath);

        // 创建音频实例
        const normalAudio = wx.createInnerAudioContext();
        const accentAudio = wx.createInnerAudioContext();

        normalAudio.src = normalPath;
        accentAudio.src = accentPath;

        // iOS音频优化设置
        normalAudio.autoplay = false;
        accentAudio.autoplay = false;
        normalAudio.obeyMuteSwitch = false;
        accentAudio.obeyMuteSwitch = false;

        let loadedCount = 0;
        const loadTimeout = setTimeout(() => {
          if (this.data.loadingSound) {
            this.setData({ loadingSound: false });
            reject(new Error('音频加载超时'));
          }
        }, 5000);

        const finishLoading = () => {
          loadedCount++;
          if (loadedCount === 2) {
            clearTimeout(loadTimeout);
            
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
            });

            console.log('[Metronome] 音频加载完成');
            resolve();
          }
        };

        normalAudio.onCanplay(() => {
          console.log('[Metronome] normal音频加载成功');
          finishLoading();
        });

        accentAudio.onCanplay(() => {
          console.log('[Metronome] accent音频加载成功');
          finishLoading();
        });

        const handleError = (type, error) => {
          console.error(`[Metronome] ${type}音频加载失败:`, error);
          clearTimeout(loadTimeout);
          this.setData({ 
            loadingSound: false,
            soundsLoaded: false
          });
          reject(error);
        };

        normalAudio.onError((err) => handleError('normal', err));
        accentAudio.onError((err) => handleError('accent', err));

      } catch (error) {
        console.error('[Metronome] 音频文件访问失败:', error);
        this.setData({ 
          loadingSound: false,
          soundsLoaded: false
        });
        reject(error);
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
          this.showToast({
            title: '正在准备音频...',
            icon: 'loading',
            duration: 1500
          });
          
          this.setData({ loadingSound: true }, () => {
            this.loadSounds().then(() => {
              console.log('[Metronome] 音频加载完成，开始播放');
      this.startMetronome();
            }).catch(err => {
              console.error('[Metronome] 音频加载失败:', err);
              this.showToast({
                title: '音频加载失败',
                icon: 'error',
                duration: 2000
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
      this.showToast({
        title: '操作失败，请重试',
        icon: 'error',
        duration: 2000
      });
    }
  },

  // 开始节拍器
  startMetronome(isTest = false) {
    if (this.data.isPlaying && !isTest) return;
    
    // 重置状态
    this.beatIndex = 0;
    this.nextBeatTime = Date.now();
    
    // 更新基础节拍间隔
    this.updateBeatDuration();
    
    // 获取当前节奏设置
    const rhythm = this.data.currentRhythm;
    const intensity = rhythm && 
      (rhythm.category === 'swing' || rhythm.category === 'shuffle') ? 
      this.data.rhythmIntensity : 1.0;
    
    // 设置播放状态
    if (!isTest) {
      this.setData({ isPlaying: true });
    }
    
    // 定义播放循环
    const scheduleNextBeat = (immediate = false) => {
      if (!this.data.isPlaying && !isTest) return;
      
      const now = Date.now();
      
      if (immediate || now >= this.nextBeatTime) {
        // 确定当前拍子是否为重音
        const currentBeat = this.beatIndex % this.data.beats.length;
        const isAccent = this.data.beats[currentBeat].type === 'accent';
        
        // 播放当前拍子
        this.playBeat(isAccent, intensity);
        
        // 计算下一拍的时间间隔
        const nextInterval = this.calculateNextBeatInterval(this.beatIndex, rhythm, intensity);
        
        // 更新下一拍时间点
        this.nextBeatTime = now + nextInterval;
        
        // 更新拍子索引
        this.beatIndex = (this.beatIndex + 1) % this.data.beats.length;
      }
      
      // 使用setTimeout实现高精度计时
      this.metronomeTimer = setTimeout(() => {
        scheduleNextBeat();
      }, 16); // 约60fps的刷新率
    };
    
    // 立即开始第一拍
    scheduleNextBeat(true);
  },

  stopMetronome() {
    console.log('[Metronome] 停止节拍器');
    
    if (!this.data.isPlaying) return;
    
    // 取消所有计时器
    if (this.metronomeTimer) {
      clearTimeout(this.metronomeTimer);
      this.metronomeTimer = null;
    }
    
    // 清理拍子切换相关的定时器和状态
    if (this.data.beatChangeTimer) {
      clearTimeout(this.data.beatChangeTimer);
    }
    
    // 安全检查
    if (!Array.isArray(this.data.beats)) {
      console.error('[Metronome] 节拍数据无效');
      this.setData({ 
        isPlaying: false
      });
      return;
    }
    
    // 重置所有拍子的活跃状态
    this.updateActiveBeat(-1);
    
    // 更新播放状态
    this.setData({ 
      isPlaying: false,
      isChangingBeat: false,
      nextBeatChange: null,
      beatChangeTimer: null,
      isTransitioning: false
    });
    
    console.log('[Metronome] 停止完成，保持BPM:', this.data.bpm);
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
    // 如果不在播放状态，不需要重启
    if (!this.data.isPlaying) return;
    
    console.log('[Metronome] 重启节拍器以应用新节奏设置');
    
    // 先停止当前节拍器
    this.stopMetronome();
    
    // 清除任何可能的节奏状态
    this.beatIndex = 0;
    this.nextBeatTime = 0;
    
    // 更新拍子显示
    this.updateActiveBeat(-1);
    
    // 短暂延迟后重新启动，确保状态更新完成
    setTimeout(() => {
      console.log('[Metronome] 应用新节奏：', this.data.currentRhythm ? this.data.currentRhythm.name : '标准节拍');
      
      // 重新创建节拍模式，确保拍号和节奏型匹配
      this.createBeatPattern();
      
      // 启动节拍器
      this.startMetronome();
      
      // 触发振动反馈
      wx.vibrateShort({ type: 'light' });
    }, 50);
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
        isChangingBeat: true,
        currentRhythm: null  // 清除当前节奏型
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
        isCustomTimeSignature: false,
        currentRhythm: null  // 清除当前节奏型
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
      const newEmphasis = [...this.data.customBeatsEmphasis, 0];
      
      this.setData({
        customBeatsCount: newCount,
        customBeatsEmphasis: newEmphasis
      });
    } else {
      this.showToast({
        title: `最多支持${this.data.maxBeatsCount}拍`,
        icon: 'error',
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
      this.showToast({
        title: `至少需要${this.data.minBeatsCount}拍`,
        icon: 'error',
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
        showCustomModal: false,
        currentRhythm: null  // 清除当前节奏型
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
      this.showToast({
        title: error.message || '应用自定义拍号出错',
        icon: 'error',
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

        this.showToast({
          title: '音色加载失败',
          icon: 'error',
          duration: 2000
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
        this.showToast({
          title: '音色切换失败',
          icon: 'error',
          duration: 2000
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
      this.showToast({
        title: '试听失败',
        icon: 'error',
        duration: 2000
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
      
      this.showToast({
        title: message,
        icon: 'error',
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
    this.showToast({
      title: newState ? '点击BPM球测速' : 'Tap tempo模式已关闭',
      icon: 'info',
      duration: 3000
    });
  },

  // 更新节拍动画时间
  updateBeatDuration() {
    const bpm = this.data.bpm;
    const rhythm = this.data.currentRhythm;
    
    // 基础节拍间隔（毫秒）
    let baseDuration = 60000 / bpm;
    
    // 根据拍号调整基础间隔
    if (this.data.timeSignature === '6/8') {
      // 6/8拍子中，每个八分音符的时值是四分音符的1/3
      baseDuration = (60000 / bpm) * (2/3);
    }
    
    this.beatDuration = baseDuration;
    console.log('[Metronome] 更新节拍间隔:', this.beatDuration, 'ms');
  },
  
  // 计算下一拍的时间间隔
  calculateNextBeatInterval(currentBeatIndex, rhythm, intensity) {
    const baseDuration = this.beatDuration;
    let nextInterval = baseDuration;
    
    if (!rhythm) return nextInterval;
    
    switch(rhythm.category) {
      case 'swing':
        if (this.data.timeSignature === '6/8') {
          // 6/8拍子下的Swing：主要影响重音，时间间隔变化较小
          if (currentBeatIndex % 3 === 0) {
            // 每组的第一拍稍微延长
            nextInterval = baseDuration * (1 + intensity * 0.2);
          } else {
            // 其他拍子稍微缩短
            nextInterval = baseDuration * (1 - intensity * 0.1);
          }
        } else {
          // 4/4拍子下的Swing：显著改变时间间隔
          if (currentBeatIndex % 2 === 0) {
            // 强拍延长
            nextInterval = baseDuration * (1 + intensity * 0.6);
          } else {
            // 弱拍缩短
            nextInterval = baseDuration * (1 - intensity * 0.6);
          }
        }
        break;
        
      case 'shuffle':
        if (this.data.timeSignature === '6/8') {
          // 6/8 Shuffle：强调三连音感
          if (currentBeatIndex % 3 === 0) {
            nextInterval = baseDuration * (1 + intensity * 0.3);
          } else {
            nextInterval = baseDuration * (1 - intensity * 0.15);
          }
        } else {
          // 4/4 Shuffle：类似Swing但力度较轻
          if (currentBeatIndex % 2 === 0) {
            nextInterval = baseDuration * (1 + intensity * 0.4);
          } else {
            nextInterval = baseDuration * (1 - intensity * 0.4);
          }
        }
        break;
        
      default:
        // 其他节奏型使用自定义的时间间隔模式
        if (rhythm.timingPattern) {
          nextInterval = baseDuration * rhythm.timingPattern[currentBeatIndex % rhythm.timingPattern.length];
        }
        break;
    }
    
    return nextInterval;
  },
  
  // 播放节拍
  playBeat(isAccent = false, intensity = 1.0) {
    const rhythm = this.data.currentRhythm;
    const currentBeat = this.beatIndex % this.data.beats.length;
    const currentBeatData = this.data.beats[currentBeat];
    
    // 判断是否需要播放这一拍
    if (currentBeatData.disabled || currentBeatData.type === 'skip') {
      this.updateActiveBeat(currentBeat);
      return;
    }
    
    // 确定这一拍的类型和强度
    let beatType = isAccent ? 'accent' : 'normal';
    let beatIntensity = intensity;
    
    // 根据节奏类型调整音量和音色
    if (rhythm && (rhythm.category === 'swing' || rhythm.category === 'shuffle')) {
      if (this.data.timeSignature === '6/8') {
        // 6/8拍子下强调1和4拍
        beatIntensity = (currentBeat === 0 || currentBeat === 3) ? 1.0 : 0.7;
      } else {
        // 4/4拍子下强调1和3拍
        beatIntensity = (currentBeat === 0 || currentBeat === 2) ? 1.0 : 0.7;
      }
    }
    
    // 播放音效
    this.playBeatSound(beatType, beatIntensity);
    
    // 更新UI显示
    this.updateActiveBeat(currentBeat);
    
    // 添加触感反馈
    if (currentBeat === 0) {
      wx.vibrateShort({ type: 'heavy' });
    } else if (isAccent) {
      wx.vibrateShort({ type: 'medium' });
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

  // 显示节奏型选择器
  showRhythmPicker() {
    const intensity = this.data.rhythmIntensity;
    const currentRhythm = this.data.currentRhythm;
    
    // 检查当前选中的节奏类型
    if (currentRhythm) {
      console.log('[Debug] 当前选中节奏类型:', currentRhythm.category);
    } else {
      console.log('[Debug] 当前未选中任何节奏');
    }
    
    // 确保节奏强度值在正确范围内（0-1）
    const normalizedIntensity = parseFloat(intensity);
    
    console.log('[Debug] 打开节奏选择器前: 强度值:', normalizedIntensity);
    
    // 先设置强度值，确保值的精确传递
    this.setData({
      rhythmIntensity: normalizedIntensity
    });
    
    // 使用setTimeout确保强度值先被设置和处理
    setTimeout(() => {
      this.setData({
        showRhythmPicker: true
      });
      console.log('[Metronome] 打开节奏选择器, 当前节奏强度:', normalizedIntensity);
    }, 50);
  },

  // 关闭节奏型选择器
  onRhythmPickerClose() {
    this.setData({
      showRhythmPicker: false
    });
  },

  // 选择节奏型
  onRhythmSelect(e) {
    const rhythmId = e.detail.rhythmId;
    const rhythm = this.data.rhythmPatterns.find(r => r.id === rhythmId);
    
    if (rhythm) {
      console.log('[Metronome] 选择节奏型:', rhythm.name, rhythm.id, '类别:', rhythm.category);
      
      // 检查是否是需要强度控制的节奏类型
      const needsIntensityControl = rhythm.category === 'swing' || rhythm.category === 'shuffle';
      console.log('[Debug] 是否需要强度控制:', needsIntensityControl);
      
      // 保存当前的播放状态
      const wasPlaying = this.data.isPlaying;
      if (wasPlaying) {
        this.stopMetronome();
      }

      // 更新拍号和节拍模式
      let newBeats = [];
      if (rhythm.defaultBeats) {
        // 使用预定义的节拍模式
        newBeats = [...rhythm.defaultBeats];
      } else {
        // 根据 pattern 创建节拍模式
        newBeats = rhythm.pattern.map(beat => ({
          type: beat === 1 ? 'accent' : 'normal',
          active: false
        }));
      }

      // 更新UI数据
      this.setData({
        currentRhythm: rhythm,
        timeSignature: rhythm.timeSignature || '4/4',
        beats: newBeats,
        isCustomTimeSignature: false
      }, () => {
        // 如果之前在播放，重新开始播放
        if (wasPlaying) {
          this.startMetronome();
        }
      });
      
      // 保存用户设置
      wx.setStorage({
        key: 'currentRhythm',
        data: rhythm
      });

      // 添加触感反馈
      wx.vibrateShort({ type: 'medium' });

      // 显示 toast 提示
      this.showToast({
        title: `已切换到:节奏型：${rhythm.name}节拍：${rhythm.timeSignature}`,
        icon: 'rhythm',
        duration: 2000
      });
    }
  },
  
  // 更新节奏型的时间签名和节拍模式
  updateTimeSignatureForRhythm(rhythm) {
    if (!rhythm) return;
    
    console.log('[Metronome] 根据节奏类型更新拍号:', rhythm.name);
    
    // 保存当前的节拍设置，以便在切换回标准节拍时恢复
    if (!this.data.savedTimeSignature) {
      this.setData({
        savedTimeSignature: this.data.timeSignature,
        savedBeats: this.data.beats ? [...this.data.beats] : null
      });
    }
    
    // 根据节奏类型设置合适的拍号和节拍模式
    let newTimeSignature = this.data.timeSignature;
    let newBeatsCount = 4;
    let defaultAccents = [];
    
    switch(rhythm.category) {
      case 'swing':
        // Swing节奏特殊处理
        if (this.data.timeSignature === '6/8') {
          // 6/8拍子下的Swing：强调1和4拍
          newBeatsCount = 6;
          defaultAccents = [true, false, false, true, false, false];
        } else {
          // 4/4拍子下的Swing：强调1和3拍
          newTimeSignature = '4/4';
          newBeatsCount = 4;
          defaultAccents = [true, false, true, false];
        }
        break;
        
      case 'shuffle':
        // Shuffle节奏特殊处理
        if (this.data.timeSignature === '6/8') {
          newBeatsCount = 6;
          defaultAccents = [true, false, false, true, false, false];
        } else {
          newTimeSignature = '4/4';
          newBeatsCount = 4;
          defaultAccents = [true, false, true, false];
        }
        break;
        
      default:
        // 其他节奏型根据pattern长度决定
        if (rhythm.pattern) {
          newBeatsCount = rhythm.pattern.length;
          defaultAccents = rhythm.pattern.map(beat => beat === 1);
        }
        break;
    }
    
    // 创建新的节拍模式
    let newBeats = [];
    for (let i = 0; i < newBeatsCount; i++) {
      newBeats.push({
        type: defaultAccents[i] ? 'accent' : 'normal',
        active: false,
        disabled: false
      });
    }
    
    // 更新UI
    this.setData({
      timeSignature: newTimeSignature,
      beats: newBeats,
      beatsCount: newBeatsCount
    });
    
    console.log('[Metronome] 已更新节拍设置:', {
      timeSignature: newTimeSignature,
      beatsCount: newBeatsCount,
      category: rhythm.category
    });
  },
  
  // 恢复到标准节拍设置
  restoreStandardTimeSignature() {
    if (this.data.savedTimeSignature) {
      this.setData({
        timeSignature: this.data.savedTimeSignature,
        beats: this.data.savedBeats || this.createDefaultBeats(this.data.savedTimeSignature),
        savedTimeSignature: null,
        savedBeats: null
      });
    }
  },
  
  // 创建默认节拍模式
  createDefaultBeats(timeSignature) {
    const [beatsCount] = timeSignature.split('/').map(Number);
    let beats = [];
    
    for (let i = 0; i < beatsCount; i++) {
      beats.push({
        type: i === 0 ? 'accent' : 'normal',
        active: false,
        disabled: false
      });
    }
    
    return beats;
  },

  // 试听节奏型
  onRhythmTest(e) {
    const rhythmId = e.detail.rhythmId;
    const rhythm = this.data.rhythmPatterns.find(r => r.id === rhythmId);
    
    if (rhythm) {
      // 不启动主节拍器，仅在组件内播放动画效果
      console.log('[Metronome] 试听节奏型:', rhythm.name);
      
      // 组件内部会通过play-beat事件通知播放对应的声音
    }
  },

  // 处理节奏型选择器播放单个拍子的事件
  onRhythmPlayBeat(e) {
    const { isAccent } = e.detail;
    // 播放对应类型的声音
    this.playBeatSound(isAccent ? 'accent' : 'normal');
  },

  // 处理节奏型选择器停止播放事件
  onRhythmTestStop(e) {
    // 当用户停止试听时的处理
    console.log('[Metronome] 停止试听节奏型');
    // 可以在这里停止相关的音频播放
  },

  // 调整节奏强度
  onRhythmIntensityChange(e) {
    // 从组件传递的intensity字段获取值
    console.log('[Debug] 节奏强度变化事件:', e.detail);
    
    // 确保从e.detail中获取intensity值
    const intensity = e.detail.intensity;
    
    if (intensity === undefined) {
      console.error('[Metronome] 未收到有效的强度值');
      return;
    }
    
    console.log('[Metronome] 节奏强度变化:', intensity);
    
    // 确保值在0-1范围内，不需要再做转换
    const normalizedIntensity = parseFloat(intensity);
    
    console.log('[Debug] 设置节奏强度:', normalizedIntensity);
    
    // 更新强度值
    this.setData({
      rhythmIntensity: normalizedIntensity
    });
    
    // 保存用户设置
    wx.setStorage({
      key: 'rhythmIntensity',
      data: normalizedIntensity
    });
    
    // 触发强度变化的视觉反馈
    this.triggerIntensityFeedback();
    
    // 更新UI显示，显示当前的摇摆强度
    if (this.data.currentRhythm && 
        (this.data.currentRhythm.category === 'swing' || this.data.currentRhythm.category === 'shuffle')) {
      
      // 注意：如果增加了摇摆强度指示器，这里可以更新指示器的显示
      console.log('[Metronome] 更新摇摆强度显示:', Math.round(normalizedIntensity * 100) + '%');
      
      // 如果正在播放则重启节拍器
      if (this.data.isPlaying) {
        this.restartMetronome();
      }
    }
  },
  
  // 触发强度变化的视觉反馈
  triggerIntensityFeedback() {
    // 轻微震动反馈
    // wx.vibrateShort({ type: 'light' });
  },

  // 更新活跃拍子的状态
  updateActiveBeat(activeIndex) {
    // 更新UI，标记当前拍子为活动状态
    const updatedBeats = this.data.beats.map((beat, idx) => ({
      ...beat,
      active: idx === activeIndex
    }));
    
    this.setData({
      beats: updatedBeats
    });
  },

  // 创建节拍模式
  createBeatPattern() {
    console.log('[Metronome] 创建节拍模式, 拍号:', this.data.timeSignature);
    
    const [beatsCount, beatValue] = this.data.timeSignature.split('/').map(Number);
    this.beatPattern = [];
    
    // 根据当前节拍和拍号创建节拍模式
    if (this.data.beats && this.data.beats.length > 0) {
      // 使用已有的节拍设置
      this.beatPattern = this.data.beats.slice();
      console.log('[Metronome] 使用现有节拍模式, 长度:', this.beatPattern.length);
    } else {
      // 创建默认节拍模式
      for (let i = 0; i < beatsCount; i++) {
        let beatType = 'normal';
        
        // 第一拍为重音拍
        if (i === 0) {
          beatType = 'accent';
        }
        
        // 对于6/8拍，第四拍也是重音
        if (this.data.timeSignature === '6/8' && i === 3) {
          beatType = 'accent';
        }
        
        this.beatPattern.push({
          type: beatType,
          active: false,
          disabled: false
        });
      }
      
      // 更新UI数据
      this.setData({
        beats: this.beatPattern,
        beatsCount: beatsCount
      });
      
      console.log('[Metronome] 创建新节拍模式, 长度:', this.beatPattern.length);
    }
    
    // 更新每拍持续时间
    this.updateBeatDuration();
  },

  showToast(options) {
    const { title, icon = 'none', duration = 2000 } = options;
    
    // 根据不同场景选择合适的图标
    let toastIcon = icon;
    
    if (icon === 'none') {
      // 根据标题内容智能选择图标
      if (title.includes('切换到') || title.includes('节奏')) {
        toastIcon = 'rhythm';
      } else if (title.includes('失败') || title.includes('错误') || title.includes('无法')) {
        toastIcon = 'error';
      } else if (title.includes('加载') || title.includes('准备') || title.includes('正在')) {
        toastIcon = 'loading';
      } else if (title.includes('成功') || title.includes('完成')) {
        toastIcon = 'success';
      } else if (title.includes('提示') || title.includes('请') || title.includes('已') || title.includes('模式')) {
        toastIcon = 'info';
      }
    }
    
    this.setData({
      toastConfig: {
        show: true,
        title,
        icon: toastIcon,
        duration
      }
    });
  },

  onToastHide() {
    this.setData({
      'toastConfig.show': false
    });
  },

  // 添加自定义音色
  addCustomSound(sound) {
    const sounds = [...this.data.sounds];
    
    // 检查是否已存在自定义音色分类
    let hasCustomCategory = this.data.soundCategories.some(
      category => category.id === 'custom'
    );

    // 如果没有自定义分类，添加它
    if (!hasCustomCategory) {
      const soundCategories = [...this.data.soundCategories];
      soundCategories.push({
        id: 'custom',
        name: '自定义音色',
        description: '使用声音合成器创建的自定义音色'
      });
      this.setData({ soundCategories });
    }

    // 添加新的音色
    sounds.push(sound);
    this.setData({ 
      sounds,
      currentSound: sound.id
    });

    // 保存到本地存储
    this.saveCustomSounds(sounds);
  },

  // 保存自定义音色列表
  saveCustomSounds(sounds) {
    const customSounds = sounds.filter(sound => sound.category === 'custom');
    wx.setStorage({
      key: 'customSounds',
      data: customSounds
    });
  },
}); 