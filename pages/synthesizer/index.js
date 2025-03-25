// 引入音频合成工具类
const AudioSynthesizer = require('../../utils/audio-synthesizer');

Page({
  data: {
    waveform: 'sine',
    frequency: 440,
    volume: 80,
    decay: 100, // 默认100ms
    soundName: '',
    canSave: false,
    isAdvancedExpanded: false,
    
    // 帮助提示数据
    showHelpPopup: false,
    helpTitle: '',
    helpDescription: '',
    helpEffect: '',
    currentHelpParam: '',
    
    // 调制参数
    modulationFrequency: 0,
    modulationDepth: 0,
    
    // 包络参数
    attackTime: 0.01,
    sustainLevel: 0.7,
    releaseTime: 0.2,
    
    // 谐波增强参数
    harmonics: {
      enabled: false,
      amount: 0.3
    },
    
    // 失谐参数
    detune: {
      enabled: false,
      amount: 5
    },
    
    // 滤波器参数
    filter: {
      type: 'lowpass',
      frequency: 4000,
      Q: 1,
      gain: 0,
      envelope: {
        enabled: false,
        amount: 0.5
      }
    },
    
    // 失真参数
    distortion: {
      enabled: false,
      amount: 0.2,
      type: 'soft'
    },
    
    // 立体声参数
    stereo: {
      enabled: false,
      pan: 0,
      width: 0.3
    }
  },

  onLoad() {
    // 创建音频合成器实例
    this.synthesizer = new AudioSynthesizer();
    
    // 初始化 Canvas
    this.initCanvas();
    
    // 从合成器获取当前参数状态
    this.syncParametersFromSynthesizer();
  },
  
  /**
   * 从合成器同步参数到界面
   */
  syncParametersFromSynthesizer() {
    if (!this.synthesizer) return;
    
    this.setData({
      // 基础参数
      waveform: this.synthesizer.waveform,
      frequency: this.synthesizer.frequency,
      volume: this.synthesizer.volume * 100,
      decay: this.synthesizer.decay,
      
      // 调制参数
      modulationFrequency: this.synthesizer.modulationFrequency,
      modulationDepth: this.synthesizer.modulationDepth * 100,
      
      // 包络参数
      attackTime: this.synthesizer.attackTime,
      sustainLevel: this.synthesizer.sustainLevel,
      releaseTime: this.synthesizer.releaseTime,
      
      // 高级参数
      harmonics: this.synthesizer.harmonics,
      detune: this.synthesizer.detune,
      filter: this.synthesizer.filter,
      distortion: this.synthesizer.distortion,
      stereo: this.synthesizer.stereo
    });
  },

  onUnload() {
    // 清理资源
    if (this.synthesizer) {
      this.synthesizer.destroy();
    }
  },

  async initCanvas() {
    try {
      const query = wx.createSelectorQuery();
      query.select('#waveformCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res[0].node;
          const dpr = wx.getSystemInfoSync().pixelRatio;
          
          // 设置 Canvas 大小
          canvas.width = res[0].width * dpr;
          canvas.height = res[0].height * dpr;
          
          // 初始化可视化
          this.synthesizer.initVisualization(canvas);
        });
    } catch (error) {
      console.error('Canvas 初始化失败:', error);
    }
  },

  // 选择波形
  selectWaveform(e) {
    const waveform = e.currentTarget.dataset.waveform;
    this.setData({ waveform });
    this.synthesizer.setWaveform(waveform);
  },

  // 频率变化
  onFrequencyChange(e) {
    const frequency = e.detail.value;
    this.setData({ frequency });
    
    // 更新合成器参数
    if (this.synthesizer) {
      this.synthesizer.setFrequency(frequency);
      // 直接显示波形，但不要在滑动过程中播放声音，避免声音过于嘈杂
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },

  // 音量变化
  onVolumeChange(e) {
    const volume = e.detail.value;
    this.setData({ volume });
    
    // 更新合成器参数
    if (this.synthesizer) {
      this.synthesizer.setVolume(volume / 100);
      
      // 直接显示波形，但不播放声音
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },

  // 衰减时间改变
  onDecayTimeChange(e) {
    const decayTime = e.detail.value;
    this.setData({ decay: decayTime });
    this.synthesizer.setDecay(decayTime);
    
    // 直接显示波形，但不播放声音
    if (e.type === 'change' && e.detail.source === 'touch') {
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 展开/折叠高级参数
  toggleAdvanced() {
    this.setData({
      isAdvancedExpanded: !this.data.isAdvancedExpanded
    });
  },
  
  // 调制频率改变
  onModulationFrequencyChange(e) {
    const frequency = e.detail.value;
    this.setData({ modulationFrequency: frequency });
    
    if (this.synthesizer) {
      this.synthesizer.setModulation(frequency, this.data.modulationDepth / 100);
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 调制深度改变
  onModulationDepthChange(e) {
    const depth = e.detail.value / 100;
    this.setData({ modulationDepth: e.detail.value });
    
    if (this.synthesizer) {
      this.synthesizer.setModulation(this.data.modulationFrequency, depth);
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 起音时间改变
  onAttackTimeChange(e) {
    const attackTime = e.detail.value / 1000; // 毫秒转秒
    this.setData({ attackTime });
    
    if (this.synthesizer) {
      this.synthesizer.setEnvelope(
        attackTime,
        this.synthesizer.decayTime,
        this.synthesizer.sustainLevel,
        this.synthesizer.releaseTime
      );
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 持续电平改变
  onSustainLevelChange(e) {
    const sustainLevel = e.detail.value / 100;
    this.setData({ sustainLevel });
    
    if (this.synthesizer) {
      this.synthesizer.setEnvelope(
        this.synthesizer.attackTime,
        this.synthesizer.decayTime,
        sustainLevel,
        this.synthesizer.releaseTime
      );
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 释音时间改变
  onReleaseTimeChange(e) {
    const releaseTime = e.detail.value / 1000; // 毫秒转秒
    this.setData({ releaseTime });
    
    if (this.synthesizer) {
      this.synthesizer.setEnvelope(
        this.synthesizer.attackTime,
        this.synthesizer.decayTime,
        this.synthesizer.sustainLevel,
        releaseTime
      );
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 谐波增强开关
  onHarmonicsEnabledChange(e) {
    const enabled = e.detail.value;
    const harmonics = { ...this.data.harmonics, enabled };
    
    this.setData({ harmonics });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ harmonics });
      
      // 开关切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 谐波量改变
  onHarmonicsAmountChange(e) {
    const amount = e.detail.value / 100;
    const harmonics = { ...this.data.harmonics, amount };
    
    this.setData({ harmonics });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ harmonics });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 失谐开关
  onDetuneEnabledChange(e) {
    const enabled = e.detail.value;
    const detune = { ...this.data.detune, enabled };
    
    this.setData({ detune });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ detune });
      
      // 开关切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 失谐量改变
  onDetuneAmountChange(e) {
    const amount = e.detail.value;
    const detune = { ...this.data.detune, amount };
    
    this.setData({ detune });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ detune });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 滤波器类型改变
  onFilterTypeChange(e) {
    const type = e.detail.value;
    const filter = { ...this.data.filter, type };
    
    this.setData({ filter });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ filter });
      
      // 类型切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 滤波器频率改变
  onFilterFrequencyChange(e) {
    const frequency = e.detail.value;
    const filter = { ...this.data.filter, frequency };
    
    this.setData({ filter });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ filter });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 滤波器Q值改变
  onFilterQChange(e) {
    const Q = e.detail.value;
    const filter = { ...this.data.filter, Q };
    
    this.setData({ filter });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ filter });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 滤波器包络开关
  onFilterEnvelopeEnabledChange(e) {
    const enabled = e.detail.value;
    const envelope = { ...this.data.filter.envelope, enabled };
    const filter = { ...this.data.filter, envelope };
    
    this.setData({ filter });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ filter });
      
      // 开关切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 滤波器包络深度改变
  onFilterEnvelopeAmountChange(e) {
    const amount = e.detail.value / 100;
    const envelope = { ...this.data.filter.envelope, amount };
    const filter = { ...this.data.filter, envelope };
    
    this.setData({ filter });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ filter });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 失真开关
  onDistortionEnabledChange(e) {
    const enabled = e.detail.value;
    const distortion = { ...this.data.distortion, enabled };
    
    this.setData({ distortion });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ distortion });
      
      // 开关切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 失真量改变
  onDistortionAmountChange(e) {
    const amount = e.detail.value / 100;
    const distortion = { ...this.data.distortion, amount };
    
    this.setData({ distortion });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ distortion });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 失真类型改变
  onDistortionTypeChange(e) {
    const type = e.detail.value;
    const distortion = { ...this.data.distortion, type };
    
    this.setData({ distortion });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ distortion });
      
      // 类型切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 立体声开关
  onStereoEnabledChange(e) {
    const enabled = e.detail.value;
    const stereo = { ...this.data.stereo, enabled };
    
    this.setData({ stereo });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ stereo });
      
      // 开关切换时直接显示波形变化
      this.synthesizer.showWaveform(false);
    }
  },
  
  // 声像位置改变
  onStereoPanChange(e) {
    const pan = e.detail.value / 100;
    const stereo = { ...this.data.stereo, pan };
    
    this.setData({ stereo });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ stereo });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 立体声宽度改变
  onStereoWidthChange(e) {
    const width = e.detail.value / 100;
    const stereo = { ...this.data.stereo, width };
    
    this.setData({ stereo });
    
    if (this.synthesizer) {
      this.synthesizer.setAdvancedParams({ stereo });
      
      // 更新波形显示
      if (e.type === 'change' && e.detail.source === 'touch') {
        this.synthesizer.showWaveform(false);
      }
    }
  },
  
  // 参数变化后预览声音
  previewAfterParamChange() {
    // 延迟一点时间，避免连续参数变化导致的过多播放
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
    }
    
    this.previewTimer = setTimeout(() => {
      this.synthesizer.playNote(false);
    }, 300);
  },

  // 试听普通音色
  previewNormal() {
    if (this.synthesizer) {
      this.synthesizer.playNote(false);
    }
  },

  // 试听重音音色
  previewAccent() {
    if (this.synthesizer) {
      this.synthesizer.playNote(true);
    }
  },

  // 播放强拍
  playStrongBeat() {
    this.synthesizer.playNote(true);
  },

  // 播放弱拍
  playWeakBeat() {
    this.synthesizer.playNote(false);
  },

  // 音色名称输入
  onSoundNameInput(e) {
    const soundName = e.detail.value;
    this.setData({
      soundName,
      canSave: !!soundName.trim()
    });
  },

  // 保存音色
  async saveSound() {
    if (!this.data.soundName) return;

    try {
      wx.showLoading({
        title: '正在生成音色...',
        mask: true
      });

      // 生成音色文件
      const { normal, accent } = await this.synthesizer.generateSoundFiles();
      
      // 保存到本地
      const soundId = `custom_${Date.now()}`;
      const normalPath = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_soft.mp3`;
      const accentPath = `${wx.env.USER_DATA_PATH}/sounds/${soundId}_hard.mp3`;
      
      // 确保目录存在
      try {
        wx.getFileSystemManager().mkdirSync(`${wx.env.USER_DATA_PATH}/sounds/`);
      } catch (e) {
        // 目录已存在，忽略错误
      }
      
      await wx.getFileSystemManager().writeFile({
        filePath: normalPath,
        data: normal,
        encoding: 'binary'
      });
      
      await wx.getFileSystemManager().writeFile({
        filePath: accentPath,
        data: accent,
        encoding: 'binary'
      });

      // 添加到音色列表
      const customSound = {
        id: soundId,
        name: this.data.soundName,
        description: '自定义合成音色',
        category: 'custom',
        normalPath: normalPath,
        accentPath: accentPath
      };

      // 获取当前页面栈
      const pages = getCurrentPages();
      const metronome = pages.find(page => page.route === 'pages/metronome/index');
      
      if (metronome) {
        metronome.addCustomSound(customSound);
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });

      // 返回上一页
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (error) {
      console.error('保存音色失败:', error);
      wx.hideLoading();
      wx.showToast({
        title: '保存失败',
        icon: 'error'
      });
    }
  },

  // 返回上一页
  goBack() {
    wx.navigateBack();
  },

  /**
   * 显示参数帮助
   */
  showHelp(e) {
    const param = e.currentTarget.dataset.param;
    const helpInfo = this.getHelpInfo(param);
    
    this.setData({
      showHelpPopup: true,
      helpTitle: helpInfo.title,
      helpDescription: helpInfo.description,
      helpEffect: helpInfo.effect,
      currentHelpParam: param
    });
  },
  
  /**
   * 隐藏帮助提示
   */
  hideHelp() {
    this.setData({
      showHelpPopup: false
    });
  },
  
  /**
   * 阻止冒泡
   */
  preventBubble() {
    // 阻止事件冒泡
    return;
  },
  
  /**
   * 试听当前参数的效果
   */
  previewHelpParam() {
    const param = this.data.currentHelpParam;
    
    // 根据不同参数调整合成器并播放示例声音
    if (this.synthesizer) {
      const originalData = { ...this.data };
      let modifiedData = { ...this.data };
      let accent = false;
      
      switch (param) {
        case 'volume':
          // 先播放较低音量，再播放较高音量
          this.synthesizer.setVolume(0.4);
          setTimeout(() => {
            this.synthesizer.playNote(false);
            setTimeout(() => {
              this.synthesizer.setVolume(0.9);
              this.synthesizer.playNote(false);
              setTimeout(() => {
                this.synthesizer.setVolume(originalData.volume / 100);
              }, 1000);
            }, 1000);
          }, 100);
          return;
          
        case 'frequency':
          // 先播放低频率，再播放高频率
          this.synthesizer.setFrequency(200);
          setTimeout(() => {
            this.synthesizer.playNote(false);
            setTimeout(() => {
              this.synthesizer.setFrequency(800);
              this.synthesizer.playNote(false);
              setTimeout(() => {
                this.synthesizer.setFrequency(originalData.frequency);
              }, 1000);
            }, 1000);
          }, 100);
          return;
          
        case 'decay':
          // 先播放短衰减，再播放长衰减
          this.synthesizer.setDecay(50);
          setTimeout(() => {
            this.synthesizer.playNote(false);
            setTimeout(() => {
              this.synthesizer.setDecay(500);
              this.synthesizer.playNote(false);
              setTimeout(() => {
                this.synthesizer.setDecay(originalData.decay);
              }, 1000);
            }, 1000);
          }, 100);
          return;
          
        case 'modulationFrequency':
        case 'modulationDepth':
        case 'modulation':
          modifiedData.modulationFrequency = 6;
          modifiedData.modulationDepth = 50;
          this.synthesizer.setModulation(6, 0.5);
          break;
          
        case 'attackTime':
          modifiedData.attackTime = 0.08;
          this.synthesizer.setEnvelope(0.08, 
            this.synthesizer.decayTime, 
            this.synthesizer.sustainLevel, 
            this.synthesizer.releaseTime);
          break;
          
        case 'sustainLevel':
          modifiedData.sustainLevel = 0.9;
          this.synthesizer.setEnvelope(
            this.synthesizer.attackTime, 
            this.synthesizer.decayTime, 
            0.9, 
            this.synthesizer.releaseTime);
          break;
          
        case 'releaseTime':
          modifiedData.releaseTime = 0.4;
          this.synthesizer.setEnvelope(
            this.synthesizer.attackTime, 
            this.synthesizer.decayTime, 
            this.synthesizer.sustainLevel, 
            0.4);
          break;
          
        case 'harmonics':
        case 'harmonicsAmount':
          modifiedData.harmonics = { enabled: true, amount: 0.8 };
          this.synthesizer.setAdvancedParams({ 
            harmonics: { enabled: true, amount: 0.8 }
          });
          break;
          
        case 'detune':
        case 'detuneAmount':
          modifiedData.detune = { enabled: true, amount: 20 };
          this.synthesizer.setAdvancedParams({ 
            detune: { enabled: true, amount: 20 }
          });
          break;
          
        case 'filter':
        case 'filterFrequency':
          modifiedData.filter = { 
            ...this.data.filter, 
            type: 'lowpass',
            frequency: 1000
          };
          this.synthesizer.setAdvancedParams({ 
            filter: { 
              ...this.synthesizer.filter, 
              type: 'lowpass',
              frequency: 1000
            }
          });
          break;
          
        case 'filterQ':
          modifiedData.filter = { 
            ...this.data.filter, 
            Q: 10
          };
          this.synthesizer.setAdvancedParams({ 
            filter: { 
              ...this.synthesizer.filter, 
              Q: 10
            }
          });
          break;
          
        case 'filterType':
          // 播放不同的滤波器类型
          const playFilterType = (type, delay) => {
            setTimeout(() => {
              this.synthesizer.setAdvancedParams({ 
                filter: { ...this.synthesizer.filter, type: type }
              });
              this.synthesizer.playNote(false);
            }, delay);
          };
          
          playFilterType('lowpass', 100);
          playFilterType('highpass', 1200);
          playFilterType('bandpass', 2300);
          playFilterType('peaking', 3400);
          
          // 恢复原始设置
          setTimeout(() => {
            this.synthesizer.setAdvancedParams({ 
              filter: { ...this.synthesizer.filter, type: originalData.filter.type }
            });
          }, 4500);
          return;
          
        case 'filterEnvelope':
        case 'filterEnvelopeAmount':
          modifiedData.filter = {
            ...this.data.filter,
            envelope: {
              enabled: true,
              amount: 0.8
            }
          };
          this.synthesizer.setAdvancedParams({
            filter: {
              ...this.synthesizer.filter,
              envelope: {
                enabled: true,
                amount: 0.8
              }
            }
          });
          break;
          
        case 'distortion':
        case 'distortionAmount':
          modifiedData.distortion = {
            enabled: true,
            amount: 0.6,
            type: this.data.distortion.type
          };
          this.synthesizer.setAdvancedParams({
            distortion: {
              enabled: true,
              amount: 0.6,
              type: this.synthesizer.distortion.type
            }
          });
          break;
          
        case 'distortionType':
          // 依次播放不同的失真类型
          const playDistortionType = (type, delay) => {
            setTimeout(() => {
              this.synthesizer.setAdvancedParams({ 
                distortion: { 
                  enabled: true, 
                  amount: 0.6, 
                  type: type 
                }
              });
              this.synthesizer.playNote(false);
            }, delay);
          };
          
          playDistortionType('soft', 100);
          playDistortionType('hard', 1200);
          playDistortionType('clip', 2300);
          playDistortionType('foldback', 3400);
          
          // 恢复原始设置
          setTimeout(() => {
            this.synthesizer.setAdvancedParams({ 
              distortion: originalData.distortion
            });
          }, 4500);
          return;
          
        case 'stereo':
        case 'stereoPan':
          modifiedData.stereo = {
            enabled: true,
            pan: 0.7,
            width: this.data.stereo.width
          };
          this.synthesizer.setAdvancedParams({
            stereo: {
              enabled: true,
              pan: 0.7,
              width: this.synthesizer.stereo.width
            }
          });
          break;
          
        case 'stereoWidth':
          modifiedData.stereo = {
            enabled: true,
            pan: 0,
            width: 0.8
          };
          this.synthesizer.setAdvancedParams({
            stereo: {
              enabled: true,
              pan: 0,
              width: 0.8
            }
          });
          break;
          
        default:
          // 默认只播放普通音符
          this.synthesizer.playNote(false);
          return;
      }
      
      // 播放示例音符
      setTimeout(() => {
        this.synthesizer.playNote(accent);
        
        // 恢复原始参数
        setTimeout(() => {
          // 恢复高级参数
          if (JSON.stringify(modifiedData) !== JSON.stringify(originalData)) {
            if (param.startsWith('modulation')) {
              this.synthesizer.setModulation(
                originalData.modulationFrequency, 
                originalData.modulationDepth / 100
              );
            } else if (param.startsWith('attack') || param.startsWith('sustain') || param.startsWith('release')) {
              this.synthesizer.setEnvelope(
                originalData.attackTime,
                this.synthesizer.decayTime,
                originalData.sustainLevel,
                originalData.releaseTime
              );
            } else {
              // 恢复高级参数
              this.synthesizer.setAdvancedParams({
                harmonics: originalData.harmonics,
                detune: originalData.detune,
                filter: originalData.filter,
                distortion: originalData.distortion,
                stereo: originalData.stereo
              });
            }
          }
        }, 1500);
      }, 100);
    }
  },
  
  /**
   * 获取参数帮助信息
   */
  getHelpInfo(param) {
    const helpInfo = {
      // 基础参数
      'volume': {
        title: '音量',
        description: '控制声音的响度。较高的音量使声音更响亮，较低的音量使声音更轻柔。',
        effect: '增加音量会使声音更大声，减少音量则使声音更轻。这个参数影响整体输出的响度。'
      },
      'frequency': {
        title: '频率',
        description: '控制声音的音高，以赫兹(Hz)为单位。较高的频率产生更高音调的声音，较低的频率产生更低音调的声音。人耳能听到的频率范围约为20Hz到20,000Hz。',
        effect: '增加频率会使声音音调升高（变尖锐），减少频率会使声音音调降低（变低沉）。'
      },
      'decay': {
        title: '衰减时间',
        description: '控制声音从最大音量减弱到静音所需的时间。较短的衰减时间产生短促的声音，较长的衰减时间则产生持续的声音。',
        effect: '增加衰减时间会使声音持续更长时间，减少衰减时间则使声音更快消失。'
      },
      
      // 调制参数
      'modulation': {
        title: '调制参数',
        description: '调制是通过一个信号改变另一个信号的特性。在音频合成中，调制可以使声音具有更丰富的变化。',
        effect: '使用调制可以创造出颤音、震音等效果，增加声音的动态感和表现力。'
      },
      'modulationFrequency': {
        title: '调制频率',
        description: '控制调制的速度，以赫兹(Hz)为单位。较高的调制频率使调制效果更快，较低的调制频率使调制效果更慢。',
        effect: '增加调制频率会使声音的颤动效果更快，减少调制频率则使颤动效果更慢。'
      },
      'modulationDepth': {
        title: '调制深度',
        description: '控制调制的强度。较高的调制深度使调制效果更明显，较低的调制深度使调制效果更微妙。',
        effect: '增加调制深度会使声音的颤动幅度更大，减少调制深度则使颤动效果更微弱。'
      },
      
      // 包络参数
      'envelope': {
        title: '包络参数',
        description: '包络控制声音随时间变化的特性，包括起音、衰减、持续和释放四个阶段(ADSR)。',
        effect: '通过调整包络参数，可以控制声音的起始特性、持续时间和消失方式，从而塑造不同的音色质感。'
      },
      'attackTime': {
        title: '起音时间',
        description: '控制声音从零到最大音量所需的时间。较短的起音时间产生更突然的声音起始，较长的起音时间产生更渐进的声音起始。',
        effect: '增加起音时间会使声音开始更平缓，减少起音时间则使声音开始更突然。长的起音时间适合弦乐等渐强音色，短的起音时间适合鼓点等打击乐器。'
      },
      'sustainLevel': {
        title: '持续电平',
        description: '控制声音在持续阶段的音量电平。较高的持续电平使声音在持续阶段更响亮，较低的持续电平使声音在持续阶段更轻柔。',
        effect: '增加持续电平会使声音在衰减后保持更大的音量，减少持续电平则使衰减后的声音更弱。'
      },
      'releaseTime': {
        title: '释音时间',
        description: '控制声音从持续电平减弱到静音所需的时间。较短的释音时间使声音停止更突然，较长的释音时间使声音停止更渐进。',
        effect: '增加释音时间会使声音结束更平缓，减少释音时间则使声音结束更突然。长的释音时间适合创造余音效果。'
      },
      
      // 谐波增强参数
      'harmonics': {
        title: '谐波增强',
        description: '谐波增强通过增加基频的倍频音调丰富声音的音色。谐波是基频的整数倍频率，它们共同构成了声音的音色特征。',
        effect: '启用谐波增强可以使声音更加丰富、明亮，增强泛音成分，让简单波形听起来更接近真实乐器的音色。'
      },
      'harmonicsAmount': {
        title: '谐波量',
        description: '控制谐波增强的强度。较高的谐波量产生更丰富的谐波内容，较低的谐波量产生更微妙的谐波增强。',
        effect: '增加谐波量会使声音更明亮、更复杂，减少谐波量则使谐波增强效果更微妙。'
      },
      
      // 失谐参数
      'detune': {
        title: '失谐',
        description: '失谐通过微调频率创造更丰富的声音质感。在音乐术语中，失谐是相对于标准音高的微小偏移。',
        effect: '启用失谐可以使声音更饱满、更自然，减少数字合成器常有的"完美"感，增加温暖度和厚度。'
      },
      'detuneAmount': {
        title: '失谐量',
        description: '控制失谐的程度，以音分(cents)为单位（100音分等于一个半音）。较高的失谐量产生更明显的失谐效果，较低的失谐量产生更微妙的失谐效果。',
        effect: '增加失谐量会使声音更宽广、更丰满，但过大的失谐会使声音听起来不和谐或失调。'
      },
      
      // 滤波器参数
      'filter': {
        title: '滤波器',
        description: '滤波器可以改变声音的频率内容，通过增强或减弱特定频率范围来塑造声音的音色。',
        effect: '使用滤波器可以模拟不同声学环境和材质对声音的影响，创造更丰富的音色变化。'
      },
      'filterType': {
        title: '滤波器类型',
        description: '不同类型的滤波器以不同方式影响声音的频率内容：\n- 低通：允许低于截止频率的频率通过，减弱高频\n- 高通：允许高于截止频率的频率通过，减弱低频\n- 带通：允许在特定频率范围内的频率通过，减弱其他频率\n- 峰值：增强特定频率范围，形成"峰值"',
        effect: '选择不同的滤波器类型可以创造截然不同的音色特征。低通滤波器使声音更温暖、更圆润；高通滤波器使声音更明亮、更尖锐；带通滤波器创造"口腔"或"喇叭"效果；峰值滤波器增强特定频率，创造共振效果。'
      },
      'filterFrequency': {
        title: '截止频率',
        description: '控制滤波器开始起作用的频率点。对于低通滤波器，高于此频率的成分将被减弱；对于高通滤波器，低于此频率的成分将被减弱；对于带通和峰值滤波器，此频率是效果最强的中心点。',
        effect: '调整截止频率可以精确控制滤波器影响声音的频率范围。较低的截止频率使低通滤波器的效果更明显，声音更闷；较高的截止频率使高通滤波器的效果更明显，声音更明亮。'
      },
      'filterQ': {
        title: 'Q值',
        description: '控制滤波器的共振或带宽。较高的Q值产生更窄的影响范围和更强的共振效果，较低的Q值产生更宽的影响范围和更平滑的过渡。',
        effect: '增加Q值会使滤波器在截止频率附近产生更明显的峰值或陷波，创造出"尖锐"或"哨声"效果；减少Q值则使滤波效果更平滑、更微妙。'
      },
      'filterEnvelope': {
        title: '滤波器包络',
        description: '滤波器包络控制滤波器参数随时间的动态变化，类似于音量包络控制音量随时间的变化。',
        effect: '启用滤波器包络可以创造出动态变化的音色，例如"哇哇"效果或音色随时间变化的扫频效果。'
      },
      'filterEnvelopeAmount': {
        title: '包络深度',
        description: '控制滤波器包络的影响程度。较高的包络深度使滤波器参数随时间变化更明显，较低的包络深度使变化更微妙。',
        effect: '增加包络深度会使滤波器随时间的变化更剧烈，减少包络深度则使变化更微妙。深度值越大，"哇哇"或扫频效果越明显。'
      },
      
      // 失真参数
      'distortion': {
        title: '失真',
        description: '失真通过增加谐波和饱和度改变声音的音色。失真是通过非线性处理音频信号产生的，可以从微妙的温暖感到强烈的破碎声。',
        effect: '启用失真可以使声音更粗糙、更有攻击性，增加声音的"存在感"和能量。失真在摇滚、金属等音乐风格中被广泛使用。'
      },
      'distortionAmount': {
        title: '失真量',
        description: '控制失真的强度。较高的失真量产生更明显的失真效果，较低的失真量产生更微妙的失真效果。',
        effect: '增加失真量会使声音更粗糙、更"脏"，减少失真量则使失真效果更微妙，可能只是增加一点温暖感或"厚度"。'
      },
      'distortionType': {
        title: '失真类型',
        description: '不同类型的失真以不同方式影响声音：\n- 软削波：渐进的、平滑的失真\n- 硬削波：突然的、强烈的失真\n- 对称削波：均匀地影响正负波形\n- 折叠：更复杂的失真，在高电平时"折叠"波形',
        effect: '选择不同的失真类型可以创造不同的音色特征。软削波产生温暖、平滑的失真；硬削波产生尖锐、刺耳的失真；对称削波产生均衡的失真；折叠产生复杂、不可预测的声音。'
      },
      
      // 立体声参数
      'stereo': {
        title: '立体声',
        description: '立体声效果通过控制声音在左右声道之间的分布创造空间感。立体声处理可以使声音听起来更宽广、更有深度。',
        effect: '启用立体声效果可以增强声音的空间感和沉浸感，使声音不再是单调的单声道，而是具有方向性和广度的体验。'
      },
      'stereoPan': {
        title: '声像位置',
        description: '控制声音在左右声道之间的平衡。负值使声音偏向左声道，正值使声音偏向右声道，零值使声音在左右声道之间平均分布。',
        effect: '调整声像位置可以控制声音在立体声场中的位置。将声音定位到左侧或右侧可以创造出方向感和空间感。'
      },
      'stereoWidth': {
        title: '宽度',
        description: '控制立体声效果的宽度。较高的宽度值使声音在立体声场中更分散，较低的宽度值使声音更集中。',
        effect: '增加宽度会使声音听起来更宽广、更环绕，减少宽度则使声音更集中、更聚焦。高宽度值适合创造宽广的合成垫音，低宽度值适合需要精确定位的声音。'
      }
    };
    
    // 如果未找到对应参数，返回默认信息
    return helpInfo[param] || {
      title: '参数说明',
      description: '该参数控制音频合成的某个方面。调整它可以改变声音的特性。',
      effect: '调整这个参数会影响音频的输出效果。'
    };
  }
}); 