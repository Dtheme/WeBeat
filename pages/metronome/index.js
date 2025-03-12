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
      { id: 'metronome_click', name: '节拍器', loaded: false },
      { id: 'woodfish', name: '木鱼', loaded: false },
      { id: 'clock_tick', name: '时钟', loaded: false },
      { id: 'clap', name: '拍手', loaded: false },
      { id: 'bongo_drum', name: '邦戈鼓', loaded: false },
      { id: 'hi_hat_closed', name: '闭合镲', loaded: false },
      { id: 'hi_hat_open', name: '开放镲', loaded: false },
      { id: 'kick_drum', name: '底鼓', loaded: false },
      { id: 'snare_drum', name: '军鼓', loaded: false }
    ],
    currentSound: 'metronome_click',
    touchStartX: 0,
    bpmBeforeTouch: 0,
    sensitivity: 0.5,
    soundsLoaded: false,
    loadingSound: false, // 新增：音频加载状态标记
    testingSound: false // 新增：音频测试状态标记
  },

  onLoad() {
    console.log('[Metronome] 页面加载开始');
    this.initAudioPool();
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
        if (audioPool[type]) {
          audioPool[type].destroy();
        }
        const audio = wx.createInnerAudioContext();
        
        // iOS音频优化设置
        audio.autoplay = false;
        audio.obeyMuteSwitch = false;
        audio.volume = 1.0;
        
        // 错误监听
        audio.onError((err) => {
          console.error(`[Metronome] ${type}音频播放错误:`, err);
          wx.showToast({
            title: '音频播放出错',
            icon: 'none'
          });
        });

        audioPool[type] = audio;
        console.log(`[Metronome] 创建音频实例 ${type} 成功`);
      });

      // 确保文件存在
      this.copyAudioFiles();
      // 加载音频
      this.loadSounds();
      
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
    if (this.data.loadingSound) {
      console.log('[Metronome] 音频正在加载中，跳过重复加载');
      return;
    }

    const currentSound = this.data.currentSound;
    console.log('[Metronome] 开始加载音频文件:', currentSound);
    
    this.setData({ loadingSound: true });
    
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
              audio.stop();
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
        });

        // 预热音频系统
        this.warmupAudioSystem();
        
      }).catch((error) => {
        console.error('[Metronome] 音频加载失败:', error);
        this.handleAudioError('音频加载失败');
        this.setData({ loadingSound: false });
      });

    } catch (error) {
      console.error('[Metronome] 加载音频失败:', error);
      this.handleAudioError('音频加载失败');
      this.setData({ loadingSound: false });
    }
  },

  // 预热音频系统
  warmupAudioSystem() {
    try {
      // 静音播放一次，预热音频系统
      ['normal', 'accent'].forEach(type => {
        const audio = audioPool[type];
        if (audio) {
          audio.volume = 0;
          audio.play();
          setTimeout(() => {
            audio.stop();
            audio.volume = 1;
          }, 100);
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
    const fs = wx.getFileSystemManager();
    const userPath = wx.env.USER_DATA_PATH;
    
    // 创建sounds目录
    try {
      fs.mkdirSync(`${userPath}/sounds`, true);
    } catch (error) {
      console.error('[Metronome] 创建sounds目录失败:', error);
    }

    // 复制所有音频文件
    this.data.sounds.forEach(sound => {
      ['soft', 'hard'].forEach(type => {
        const fileName = `${sound.id}_${type}.mp3`;
        try {
          fs.copyFileSync(
            `/sounds/${fileName}`,
            `${userPath}/sounds/${fileName}`
          );
          console.log(`[Metronome] 复制文件成功: ${fileName}`);
        } catch (error) {
          console.error(`[Metronome] 复制文件失败: ${fileName}`, error);
        }
      });
    });
  },

  // 处理圆圈点击
  onCircleTap() {
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_DELAY) {
      // 双击检测到，切换播放状态
      this.togglePlay();
      lastTapTime = 0; // 重置最后点击时间
    } else {
      lastTapTime = now;
    }
  },

  togglePlay() {
    if (this.data.isPlaying) {
      this.stopMetronome();
    } else {
      this.startMetronome();
    }
  },

  startMetronome() {
    try {
      if (this.data.isPlaying) {
        console.log('[Metronome] 已经在播放中，忽略重复调用');
        return;
      }

      console.log('[Metronome] 开始播放节拍器');
      let currentBeat = 0;
      const beatDuration = 60000 / this.data.bpm; // 毫秒每拍

      const playBeat = () => {
        if (!this.data.isPlaying) {
          console.log('[Metronome] 播放已停止');
          return;
        }

        console.log('[Metronome] 播放拍子:', currentBeat);
        const beats = this.data.beats.map((beat, index) => ({
          ...beat,
          active: index === currentBeat
        }));

        this.setData({ beats });

        if (beats[currentBeat].type !== 'skip') {
          this.playBeatSound(beats[currentBeat].type);
        }

        setTimeout(() => {
          if (!this.data.isPlaying) return;
          
          const updatedBeats = beats.map(beat => ({
            ...beat,
            active: false
          }));
          this.setData({ beats: updatedBeats });
        }, 200);

        currentBeat = (currentBeat + 1) % beats.length;
        
        // 设置下一拍的定时器
        if (this.data.isPlaying) {
          console.log('[Metronome] 设置下一拍定时器:', beatDuration);
          metronomeTimer = setTimeout(playBeat, beatDuration);
        }
      };

      this.setData({ isPlaying: true }, () => {
        console.log('[Metronome] 播放状态已更新，开始第一拍');
        playBeat(); // 立即播放第一拍
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
    if (metronomeTimer) {
      clearTimeout(metronomeTimer);
      metronomeTimer = null;
      console.log('[Metronome] 清理定时器完成');
    }
    
    const beats = this.data.beats.map(beat => ({
      ...beat,
      active: false
    }));
    
    this.setData({ 
      isPlaying: false,
      beats,
      currentBeat: 0
    }, () => {
      console.log('[Metronome] 停止状态已更新');
    });
  },

  playBeatSound(beatType) {
    try {
      const audio = audioPool[beatType === 'accent' ? 'accent' : 'normal'];
      if (!audio) {
        console.error('[Metronome] 音频实例不存在');
        return;
      }

      // iOS音频播放优化
      if (audio.paused === undefined || audio.paused) {
        audio.stop();
        // 短暂延迟后播放，避免iOS的音频堆叠问题
        setTimeout(() => {
          audio.play();
        }, 10);
      } else {
        audio.stop();
        audio.play();
      }
    } catch (error) {
      console.error('[Metronome] 播放音频失败:', error);
      // 尝试重新初始化音频
      this.initAudioPool();
    }
  },

  // BPM手势控制
  onTouchStart(e) {
    this.setData({
      touchStartX: e.touches[0].clientX,
      bpmBeforeTouch: this.data.bpm
    });
  },

  onTouchMove(e) {
    const deltaX = e.touches[0].clientX - this.data.touchStartX;
    const newBpm = Math.min(200, Math.max(40, 
      this.data.bpmBeforeTouch + Math.round(deltaX * this.data.sensitivity)
    ));
    
    if (newBpm !== this.data.bpm) {
      this.setData({ bpm: newBpm });
      
      if (this.data.isPlaying) {
        this.restartMetronome();
      }
    }
  },

  onTouchEnd() {
    // 可以添加触感反馈
    wx.vibrateShort({
      type: 'medium'
    });
  },

  restartMetronome() {
    this.stopMetronome();
    this.startMetronome();
  },

  // 切换节拍类型
  onBeatTap(e) {
    const index = e.currentTarget.dataset.index;
    const beats = [...this.data.beats];
    const types = ['normal', 'accent', 'skip'];
    const currentType = beats[index].type;
    const nextTypeIndex = (types.indexOf(currentType) + 1) % types.length;
    
    beats[index] = {
      ...beats[index],
      type: types[nextTypeIndex]
    };
    
    this.setData({ beats });
  },

  // 切换拍号
  changeTimeSignature(e) {
    try {
      const pattern = e.currentTarget.dataset.pattern;
      console.log('[Metronome] 开始切换拍号:', pattern);
      console.log('[Metronome] 当前状态:', {
        isPlaying: this.data.isPlaying,
        currentBeat: this.data.currentBeat,
        currentBeats: this.data.beats
      });

      let beats;
      
      switch (pattern) {
        case '3/4':
          beats = [
            { type: 'accent', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false }
          ];
          break;
        case '6/8':
          beats = [
            { type: 'accent', active: false },
            { type: 'normal', active: false },
            { type: 'normal', active: false },
            { type: 'accent', active: false },
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

      console.log('[Metronome] 新的拍子配置:', beats);

      // 如果正在播放，先停止
      if (this.data.isPlaying) {
        console.log('[Metronome] 当前正在播放，先停止');
        this.stopMetronome();
      }

      // 使用回调确保状态更新完成后再重启
      this.setData({
        timeSignature: pattern,
        beats,
        currentBeat: 0
      }, () => {
        console.log('[Metronome] 拍号切换完成');
        if (this.data.isPlaying) {
          console.log('[Metronome] 重新开始播放');
          this.startMetronome();
        }
      });

    } catch (error) {
      console.error('[Metronome] 切换拍号出错:', error);
      wx.showToast({
        title: '切换拍号失败',
        icon: 'none'
      });
    }
  },

  // 切换音色
  changeSound(e) {
    const soundId = e.currentTarget.dataset.sound;
    console.log('[Metronome] 切换音色:', soundId);
    
    // 如果正在加载音频，显示提示并返回
    if (this.data.loadingSound) {
      wx.showToast({
        title: '音频加载中，请稍候',
        icon: 'none'
      });
      return;
    }
    
    // 如果是同一个音色，不需要重新加载
    if (soundId === this.data.currentSound && this.data.soundsLoaded) {
      console.log('[Metronome] 已经是当前音色，无需重新加载');
      return;
    }
    
    // 停止当前播放
    if (this.data.isPlaying) {
      this.stopMetronome();
    }
    
    this.setData({ 
      currentSound: soundId,
      soundsLoaded: false
    }, () => {
      console.log('[Metronome] 开始加载新音色');
      this.loadSounds();
    });
  },

  // 测试当前音色
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

    console.log('[Metronome] 测试音色:', this.data.currentSound);
    
    this.setData({ testingSound: true });
    
    try {
      // iOS音频播放优化
      const playAudioWithDelay = (audio) => {
        return new Promise((resolve) => {
          audio.stop();
          setTimeout(() => {
            audio.play();
            resolve();
          }, 10);
        });
      };

      // 播放重音和普通音各一次
      playAudioWithDelay(audioPool.accent)
        .then(() => new Promise(resolve => setTimeout(resolve, 500)))
        .then(() => playAudioWithDelay(audioPool.normal))
        .then(() => new Promise(resolve => setTimeout(resolve, 500)))
        .then(() => {
          this.setData({ testingSound: false });
        })
        .catch(error => {
          console.error('[Metronome] 测试音频播放失败:', error);
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
  }
}); 