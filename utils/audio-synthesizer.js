/**
 * 音频合成器类
 * 用于生成不同波形的音频
 */
class AudioSynthesizer {
  constructor() {
    // 初始化参数
    this.waveform = 'sine';
    this.frequency = 440;
    this.volume = 0.8;
    this.decay = 100;
    
    // 调制参数
    this.modulationFrequency = 0;
    this.modulationDepth = 0;
    
    // ADSR包络参数
    this.attackTime = 0.01;
    this.decayTime = 0.1;
    this.sustainLevel = 0.7;
    this.releaseTime = 0.2;
    
    // 添加高级参数
    this.harmonics = {
      enabled: false,
      amount: 0.3,     // 谐波增强量 (0-1)
      ratio: [1, 0.5, 0.25, 0.125], // 谐波比例
    };
    
    this.detune = {
      enabled: false,
      amount: 5,       // 失谐量 (cents)
      spread: 0.8,     // 立体声宽度 (0-1)
    };
    
    this.filter = {
      type: 'lowpass',  // 'lowpass', 'highpass', 'bandpass', 'peaking'
      frequency: 4000,  // 滤波器频率 (Hz)
      Q: 1,             // 谐振/Q值
      gain: 0,          // 增益 (dB，用于峰值滤波)
      envelope: {
        enabled: false,
        attack: 0.05,   // 滤波器包络起音 (s)
        decay: 0.2,     // 滤波器包络衰减 (s)
        sustain: 0.3,   // 滤波器包络持续电平 (0-1)
        release: 0.1,   // 滤波器包络释放 (s)
        amount: 0.5,    // 包络调制深度 (0-1)
      },
    };
    
    this.distortion = {
      enabled: false,
      amount: 0.2,      // 失真量 (0-1)
      type: 'soft',     // 'soft', 'hard', 'clip', 'foldback'
    };
    
    this.stereo = {
      enabled: false,
      width: 0.3,       // 立体声宽度 (0-1)
      pan: 0,           // 声像位置 (-1 左 to 1 右)
    };
    
    this._initAudioContext();
    
    // 波形绘制相关
    this.visualPoints = 200; // 控制绘制点数
    this.lastDrawTime = 0;
    this.drawInterval = 1000 / 30; // 30fps
    
    // 可视化相关
    this.canvas = null;
    this.canvasCtx = null;
    this.animationTimer = null;
    this.isVisualizing = false;
    
    // 错误重试机制
    this.retryCount = 0;
    this.maxRetries = 3;
  }
  
  /**
   * 初始化音频上下文
   * @private
   */
  _initAudioContext() {
    try {
      // 创建音频上下文
      this.audioContext = wx.createWebAudioContext();
      
      // 创建音频处理节点
      this.oscillator = this.audioContext.createOscillator();
      this.gainNode = this.audioContext.createGain();
      this.filterNode = this.audioContext.createBiquadFilter();
      
      // 为高级功能准备节点
      try {
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        
        // 创建立体声节点
        this.stereoPannerNode = this.audioContext.createStereoPanner();
        
        // 为谐波和失真创建工作区
        this.workletSupported = typeof this.audioContext.createGain === 'function';
        if (this.workletSupported) {
          // 创建谐波处理器节点
          this.harmonicsGainNode = this.audioContext.createGain();
          
          // 创建失真节点
          this.distortionNode = this.audioContext.createWaveShaper();
          this._createDistortionCurve(this.distortion.amount);
        }
      } catch (e) {
        console.warn('高级音频功能初始化失败:', e);
        this.workletSupported = false;
      }
      
      // 根据支持情况连接节点
      if (this.workletSupported) {
        // 连接完整的音频处理链
        this.oscillator.connect(this.harmonicsGainNode);
        this.harmonicsGainNode.connect(this.distortionNode);
        this.distortionNode.connect(this.filterNode);
        this.filterNode.connect(this.stereoPannerNode);
        this.stereoPannerNode.connect(this.gainNode);
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
      } else {
        // 连接基本音频处理链
        this.oscillator.connect(this.filterNode);
        this.filterNode.connect(this.gainNode);
        this.gainNode.connect(this.audioContext.destination);
      }
      
      // 初始化分析器数据
      if (this.analyser) {
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
      }
      
      // 设置初始状态
      this.gainNode.gain.value = 0; // 初始音量为0
      this.oscillator.start(); // 启动振荡器
      
      // 设置默认滤波器参数
      this.filterNode.type = 'lowpass';
      this.filterNode.frequency.value = 8000;
      this.filterNode.Q.value = 0.5;
      
      // 应用立体声设置
      if (this.stereoPannerNode) {
        this.stereoPannerNode.pan.value = this.stereo.pan;
      }
      
      console.log('音频上下文初始化成功');
    } catch (error) {
      console.error('音频上下文初始化失败:', error);
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`尝试重新初始化音频上下文 (${this.retryCount}/${this.maxRetries})`);
        setTimeout(() => this._initAudioContext(), 500);
      }
    }
  }
  
  /**
   * 设置高级参数
   * @param {Object} params - 高级参数对象
   */
  setAdvancedParams(params) {
    if (!params) return;
    
    // 更新谐波参数
    if (params.harmonics !== undefined) {
      this.harmonics = { ...this.harmonics, ...params.harmonics };
    }
    
    // 更新失谐参数
    if (params.detune !== undefined) {
      this.detune = { ...this.detune, ...params.detune };
    }
    
    // 更新滤波器参数
    if (params.filter !== undefined) {
      if (typeof params.filter === 'object') {
        // 更新顶层滤波器参数
        Object.keys(params.filter).forEach(key => {
          if (key !== 'envelope') {
            this.filter[key] = params.filter[key];
          }
        });
        
        // 更新滤波器包络参数
        if (params.filter.envelope !== undefined) {
          this.filter.envelope = { ...this.filter.envelope, ...params.filter.envelope };
        }
      }
      
      // 实时更新滤波器设置
      if (this.filterNode) {
        this._updateFilterSettings();
      }
    }
    
    // 更新失真参数
    if (params.distortion !== undefined) {
      this.distortion = { ...this.distortion, ...params.distortion };
      
      // 更新失真曲线
      if (this.distortionNode) {
        this._createDistortionCurve(this.distortion.amount);
      }
    }
    
    // 更新立体声参数
    if (params.stereo !== undefined) {
      this.stereo = { ...this.stereo, ...params.stereo };
      
      // 更新立体声设置
      if (this.stereoPannerNode) {
        this.stereoPannerNode.pan.value = this.stereo.pan;
      }
    }
    
    // 如果有波形显示，则更新波形
    if (this.canvas && this.canvasCtx) {
      this.showWaveform(false);
    }
  }
  
  /**
   * 创建失真曲线
   * @private
   * @param {number} amount - 失真量
   */
  _createDistortionCurve(amount) {
    if (!this.distortionNode) return;
    
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    const type = this.distortion.type || 'soft';
    
    for (let i = 0; i < samples; ++i) {
      const x = i * 2 / samples - 1;
      
      // 根据失真类型应用不同的失真算法
      switch (type) {
        case 'soft': // 软削波
          curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
          break;
          
        case 'hard': // 硬削波
          if (x < -amount) curve[i] = -1;
          else if (x > amount) curve[i] = 1;
          else curve[i] = x / amount;
          break;
          
        case 'clip': // 对称削波
          const threshold = 1 - amount;
          if (x < -threshold) curve[i] = -1;
          else if (x > threshold) curve[i] = 1;
          else curve[i] = x;
          break;
          
        case 'foldback': // 折叠失真
          if (x < -amount) curve[i] = -2 * amount - x;
          else if (x > amount) curve[i] = 2 * amount - x;
          else curve[i] = x;
          break;
          
        default: // 默认为软失真
          curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
      }
    }
    
    this.distortionNode.curve = curve;
  }
  
  /**
   * 更新滤波器设置
   * @private
   */
  _updateFilterSettings() {
    if (!this.filterNode) return;
    
    const now = this.audioContext.currentTime;
    
    // 应用滤波器类型
    this.filterNode.type = this.filter.type;
    
    // 应用频率和Q值
    this.filterNode.frequency.cancelScheduledValues(now);
    this.filterNode.Q.cancelScheduledValues(now);
    
    this.filterNode.frequency.setValueAtTime(this.filter.frequency, now);
    this.filterNode.Q.setValueAtTime(this.filter.Q, now);
    
    // 应用增益（如果是峰值滤波器）
    if (this.filter.type === 'peaking' && this.filterNode.gain) {
      this.filterNode.gain.cancelScheduledValues(now);
      this.filterNode.gain.setValueAtTime(this.filter.gain, now);
    }
  }
  
  /**
   * 生成音频缓冲区 - 加入高级参数处理
   * @private
   * @param {boolean} isAccent - 是否为重音
   * @returns {Promise<ArrayBuffer>}
   */
  async _generateAudioBuffer(isAccent) {
    try {
      // 计算总时长和采样数
      const attackTime = isAccent ? 0.01 : 0.03;
      const decayTime = this.decay / 1000;
      const totalDuration = attackTime + (isAccent ? decayTime * 1.5 : decayTime);
      const sampleRate = 44100;
      const numSamples = Math.floor(totalDuration * sampleRate);
      
      // 创建缓冲区
      const buffer = new Float32Array(numSamples);
      
      // 根据不同波形调整音量
      let baseVolume;
      switch (this.waveform) {
        case 'sine':
          baseVolume = isAccent ? this.volume * 1.8 : this.volume * 0.9;
          break;
        case 'square':
          baseVolume = isAccent ? this.volume * 1.4 : this.volume * 0.7;
          break;
        case 'triangle':
          baseVolume = isAccent ? this.volume * 1.6 : this.volume * 0.8;
          break;
        case 'sawtooth':
          baseVolume = isAccent ? this.volume * 1.5 : this.volume * 0.75;
          break;
        default:
          baseVolume = isAccent ? this.volume * 1.6 : this.volume * 0.8;
      }
      
      // 频率参数
      const angularFrequency = 2 * Math.PI * this.frequency;
      const detuneRatio = isAccent ? 1.006 : 1.0;
      
      // 应用失谐
      const detuneAmount = this.detune.enabled ? this.detune.amount : 0;
      const detuneFactor = Math.pow(2, detuneAmount / 1200); // 音分到频率比转换
      
      // 应用立体声设置 - 左右声道可以有不同的处理
      const stereoSpread = (this.stereo.enabled && this.stereo.width > 0) ? this.stereo.width : 0;
      
      // 谐波控制
      const harmonicsAmount = this.harmonics.enabled ? this.harmonics.amount : 0;
      const harmonicsRatio = this.harmonics.ratio || [1, 0.5, 0.25, 0.125];
      
      // 波形生成参数
      const harmonicsCount = {
        square: 15,
        sawtooth: 10
      };
      
      // 滤波器包络参数
      const filterEnvEnabled = this.filter.envelope.enabled;
      const filterEnvAmount = this.filter.envelope.amount;
      const filterAttackTime = this.filter.envelope.attack;
      const filterDecayTime = this.filter.envelope.decay;
      const filterSustainLevel = this.filter.envelope.sustain;
      
      // 线程让步间隔
      const chunkSize = Math.min(4096, numSamples);
      let lastYieldTime = Date.now();
      
      // 生成音频数据
      for (let i = 0; i < numSamples; i++) {
        // 定期让出线程，避免长时间阻塞
        if (i % chunkSize === 0 && Date.now() - lastYieldTime > 50) {
          await new Promise(resolve => setTimeout(resolve, 0));
          lastYieldTime = Date.now();
        }
        
        const t = i / sampleRate;
        let sample = 0;
        
        // 应用基本波形
        sample = this._generateBasicWaveform(t, angularFrequency, detuneRatio * detuneFactor);
        
        // 应用谐波增强
        if (harmonicsAmount > 0) {
          sample = this._applyHarmonics(sample, t, angularFrequency, detuneRatio * detuneFactor, harmonicsAmount, harmonicsRatio);
        }
        
        // 应用包络
        const normalizedTime = t / totalDuration;
        let envelope = this._calculateEnvelope(normalizedTime, isAccent, baseVolume);
        
        // 应用滤波器包络调制
        if (filterEnvEnabled) {
          const filterEnvelopeValue = this._calculateFilterEnvelope(normalizedTime, totalDuration);
          sample = this._applyFilterEnvelope(sample, filterEnvelopeValue, filterEnvAmount);
        }
        
        // 应用失真
        if (this.distortion.enabled && this.distortion.amount > 0) {
          sample = this._applyDistortion(sample, this.distortion.amount, this.distortion.type);
        }
        
        // 保存到缓冲区
        buffer[i] = sample * envelope;
      }
      
      // 应用平滑处理
      this._applySmoothing(buffer, 3);
      
      return buffer.buffer;
    } catch (error) {
      console.error('生成音频缓冲区失败:', error, '波形:', this.waveform, '频率:', this.frequency);
      throw error;
    }
  }
  
  /**
   * 生成基本波形
   * @private
   * @param {number} t - 时间点
   * @param {number} angularFrequency - 角频率
   * @param {number} detuneRatio - 失谐比例
   * @returns {number} - 波形值
   */
  _generateBasicWaveform(t, angularFrequency, detuneRatio) {
    let sample = 0;
    
    // 应用调制
    const modAmount = this.modulationDepth > 0 ? Math.sin(2 * Math.PI * this.modulationFrequency * t) * this.modulationDepth : 0;
    const modulatedFreq = angularFrequency * (1 + modAmount);
    
    switch (this.waveform) {
      case 'sine':
        sample = Math.sin(modulatedFreq * t * detuneRatio);
        break;
        
      case 'square':
        if (this.frequency < 1000) {
          // 低频使用傅里叶级数
          for (let n = 1; n <= 15; n += 2) {
            sample += Math.sin(n * modulatedFreq * t * detuneRatio) / n;
          }
          sample = sample * (4 / Math.PI);
        } else {
          // 高频使用简单方法
          sample = Math.sin(modulatedFreq * t * detuneRatio) > 0 ? 1 : -1;
        }
        break;
        
      case 'triangle':
        const phaseTriangle = (t * this.frequency * detuneRatio * (1 + modAmount)) % 1;
        sample = 2 * Math.abs(2 * phaseTriangle - 1) - 1;
        break;
        
      case 'sawtooth':
        if (this.frequency < 1000) {
          // 低频使用傅里叶级数
          for (let n = 1; n <= 10; n++) {
            sample += Math.sin(n * modulatedFreq * t * detuneRatio) / n;
          }
          sample = sample * (2 / Math.PI);
        } else {
          // 高频使用简单方法
          sample = 2 * ((t * this.frequency * detuneRatio * (1 + modAmount)) % 1) - 1;
        }
        break;
    }
    
    return sample;
  }
  
  /**
   * 应用谐波增强
   * @private
   * @param {number} sample - 原始样本
   * @param {number} t - 时间点
   * @param {number} angularFrequency - 角频率
   * @param {number} detuneRatio - 失谐比例
   * @param {number} amount - 谐波增强量
   * @param {Array} ratio - 谐波比例
   * @returns {number} - 处理后样本
   */
  _applyHarmonics(sample, t, angularFrequency, detuneRatio, amount, ratio) {
    // 基本波形信号
    let harmonicSignal = 0;
    
    // 根据波形类型应用不同的谐波增强策略
    switch (this.waveform) {
      case 'sine':
        // 为正弦波添加2、3、4次谐波
        for (let i = 1; i < ratio.length && i < 4; i++) {
          harmonicSignal += Math.sin((i + 1) * angularFrequency * t * detuneRatio) * ratio[i];
        }
        break;
        
      case 'square':
        // 为方波添加奇次谐波
        for (let i = 1; i < ratio.length * 2 && i < 8; i += 2) {
          harmonicSignal += Math.sin((i + 2) * angularFrequency * t * detuneRatio) * (ratio[Math.floor(i/2)] / (i + 2));
        }
        break;
        
      case 'triangle':
        // 为三角波添加奇次谐波，但相位不同
        for (let i = 1; i < ratio.length * 2 && i < 8; i += 2) {
          const phase = (i % 4 === 1) ? 0 : Math.PI;
          harmonicSignal += Math.sin((i + 2) * angularFrequency * t * detuneRatio + phase) * 
                           (ratio[Math.floor(i/2)] / ((i + 2) * (i + 2)));
        }
        break;
        
      case 'sawtooth':
        // 为锯齿波添加所有谐波
        for (let i = 1; i < ratio.length && i < 4; i++) {
          harmonicSignal += Math.sin((i + 1) * angularFrequency * t * detuneRatio) * (ratio[i] / (i + 1));
        }
        break;
    }
    
    // 混合原始信号和谐波增强信号
    return sample * (1 - amount) + harmonicSignal * amount;
  }
  
  /**
   * 计算滤波器包络值
   * @private
   * @param {number} normalizedTime - 归一化时间
   * @param {number} totalDuration - 总持续时间
   * @returns {number} - 包络值
   */
  _calculateFilterEnvelope(normalizedTime, totalDuration) {
    const attackTime = this.filter.envelope.attack;
    const decayTime = this.filter.envelope.decay;
    const sustainLevel = this.filter.envelope.sustain;
    
    const attackEnd = attackTime / totalDuration;
    const decayEnd = attackEnd + (decayTime / totalDuration);
    
    if (normalizedTime < attackEnd) {
      // 上升阶段：线性上升到1
      return normalizedTime / attackEnd;
    } else if (normalizedTime < decayEnd) {
      // 衰减阶段：从1衰减到sustainLevel
      const decayPhase = (normalizedTime - attackEnd) / (decayEnd - attackEnd);
      return 1 - (1 - sustainLevel) * decayPhase;
    } else {
      // 持续阶段：保持在sustainLevel
      return sustainLevel;
    }
  }
  
  /**
   * 应用滤波器包络调制
   * @private
   * @param {number} sample - 原始样本
   * @param {number} envelopeValue - 包络值
   * @param {number} amount - 调制深度
   * @returns {number} - 处理后样本
   */
  _applyFilterEnvelope(sample, envelopeValue, amount) {
    // 此处为简化模拟，实际滤波器需要更复杂的实现
    // 这里使用一个简单的一阶低通滤波器模拟
    if (this._filterState === undefined) {
      this._filterState = sample;
    }
    
    // 计算滤波系数，基于包络和调制深度
    const filterCoeff = Math.pow(0.5, (1 - envelopeValue * amount) * 5);
    
    // 应用滤波器
    this._filterState = this._filterState * (1 - filterCoeff) + sample * filterCoeff;
    
    return this._filterState;
  }
  
  /**
   * 应用失真效果
   * @private
   * @param {number} sample - 原始样本
   * @param {number} amount - 失真量
   * @param {string} type - 失真类型
   * @returns {number} - 处理后样本
   */
  _applyDistortion(sample, amount, type) {
    switch (type) {
      case 'soft':
        // 软削波
        return (Math.PI + amount) * sample / (Math.PI + amount * Math.abs(sample));
        
      case 'hard':
        // 硬削波
        if (sample < -amount) return -1;
        else if (sample > amount) return 1;
        else return sample / amount;
        
      case 'clip':
        // 对称削波
        const threshold = 1 - amount;
        if (sample < -threshold) return -1;
        else if (sample > threshold) return 1;
        else return sample;
        
      case 'foldback':
        // 折叠失真
        amount = amount * 0.5 + 0.1; // 调整为合理范围
        if (sample < -amount) return -amount - (sample + amount) % (amount * 2);
        else if (sample > amount) return amount - (sample - amount) % (amount * 2);
        else return sample;
        
      default:
        return sample;
    }
  }

  /**
   * 重新创建音频节点
   * @private
   */
  _recreateAudioNodes() {
    try {
      // 断开旧节点连接
      if (this.oscillator) {
        this.oscillator.disconnect();
      }
      
      // 创建新振荡器
      this.oscillator = this.audioContext.createOscillator();
      this.oscillator.type = this.waveform;
      this.oscillator.frequency.value = this.frequency;
      
      // 重新连接
      if (this.workletSupported) {
        // 连接完整的音频处理链
        this.oscillator.connect(this.harmonicsGainNode);
      } else {
        // 连接基本音频处理链
        this.oscillator.connect(this.filterNode);
      }
      
      this.oscillator.start();
      
      return true;
    } catch (error) {
      console.error('重新创建音频节点失败:', error);
      return false;
    }
  }

  /**
   * 设置波形类型
   * @param {string} type - 波形类型：'sine', 'square', 'triangle', 'sawtooth'
   */
  setWaveform(type) {
    this.waveform = type;
    if (this.oscillator) {
      this.oscillator.type = type;
      
      // 根据波形类型调整滤波器参数，增强波形特征
      if (this.filterNode) {
        const currentTime = this.audioContext.currentTime;
        
        // 更新内部滤波器设置对象
        switch (type) {
          case 'sine':
            // 正弦波通常保持清晰透明的音色
            this.filter.type = 'lowpass';
            this.filter.frequency = 8000;
            this.filter.Q = 0.5;
            break;
          case 'square':
            // 方波含有丰富的奇次谐波，需要适当裁剪高频
            this.filter.type = 'lowpass';
            this.filter.frequency = 3000;
            this.filter.Q = 8;
            break;
          case 'triangle':
            // 三角波谐波较少，增强中频以提高辨识度
            this.filter.type = 'bandpass';
            this.filter.frequency = 2000;
            this.filter.Q = 3;
            break;
          case 'sawtooth':
            // 锯齿波含有丰富的谐波，使用峰值滤波增强特征频率
            this.filter.type = 'peaking';
            this.filter.frequency = 1200;
            this.filter.Q = 5;
            this.filter.gain = 6; // 增益提升特征频率
            break;
        }
        
        // 应用滤波器设置到节点
        this.filterNode.type = this.filter.type;
        this.filterNode.frequency.setValueAtTime(this.filter.frequency, currentTime);
        this.filterNode.Q.setValueAtTime(this.filter.Q, currentTime);
        
        if (this.filter.type === 'peaking' && this.filterNode.gain) {
          this.filterNode.gain.setValueAtTime(this.filter.gain, currentTime);
        }
      }
    }
    
    // 更新显示
    if (this.canvas && this.canvasCtx) {
      this.showWaveform(false);
    }
  }

  /**
   * 设置频率
   * @param {number} freq - 频率值（Hz）
   */
  setFrequency(freq) {
    this.frequency = freq;
    if (this.oscillator) {
      this.oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);
    }
  }

  /**
   * 设置音量
   * @param {number} vol - 音量值（0-1）
   */
  setVolume(vol) {
    this.volume = vol;
    if (this.gainNode) {
      this.gainNode.gain.setValueAtTime(vol, this.audioContext.currentTime);
    }
  }

  /**
   * 设置衰减时间
   * @param {number} dec - 衰减时间（毫秒）
   */
  setDecay(dec) {
    this.decay = dec;
  }

  /**
   * 设置调制参数
   * @param {number} freq - 调制频率
   * @param {number} depth - 调制深度
   */
  setModulation(freq, depth) {
    this.modulationFrequency = freq;
    this.modulationDepth = depth;
    
    if (this.filterNode && this.oscillator) {
      this.filterNode.frequency.setValueAtTime(freq, this.audioContext.currentTime);
      this.oscillator.frequency.setValueAtTime(
        this.frequency * (1 + depth),
        this.audioContext.currentTime
      );
    }
  }

  /**
   * 设置ADSR包络参数
   * @param {number} attack - 起音时间
   * @param {number} decay - 衰减时间
   * @param {number} sustain - 持续音量
   * @param {number} release - 释放时间
   */
  setEnvelope(attack, decay, sustain, release) {
    this.attackTime = attack;
    this.decayTime = decay;
    this.sustainLevel = sustain;
    this.releaseTime = release;
  }

  /**
   * 初始化可视化
   * @param {object} canvas - Canvas 实例
   */
  initVisualization(canvas) {
    this.canvas = canvas;
    this.canvasCtx = canvas.getContext('2d');
    this.startVisualization();
  }

  /**
   * 开始可视化
   */
  startVisualization() {
    if (!this.canvas || !this.canvasCtx) return;
    this.isVisualizing = true;
    this.draw();
  }

  /**
   * 停止可视化
   */
  stopVisualization() {
    this.isVisualizing = false;
    if (this.animationTimer) {
      clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
  }

  /**
   * 绘制波形和频谱
   */
  draw() {
    if (!this.isVisualizing) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.canvasCtx;

    // 获取音频数据
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDataArray = new Uint8Array(bufferLength);
    
    // 获取频谱数据
    this.analyser.getByteFrequencyData(dataArray);
    // 获取时域数据
    this.analyser.getByteTimeDomainData(timeDataArray);

    // 清除画布
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(0, 0, width, height);

    // 绘制波形
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    
    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = timeDataArray[i] / 128.0;
      const y = v * height / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.stroke();

    // 绘制频谱
    ctx.fillStyle = 'rgba(245, 158, 11, 0.3)';
    const barWidth = width / bufferLength;
    let barX = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height;
      ctx.fillRect(barX, height - barHeight, barWidth, barHeight);
      barX += barWidth;
    }

    // 继续动画
    this.animationTimer = setTimeout(() => this.draw(), this.drawInterval);
  }

  /**
   * 显示波形
   * @param {boolean} isAccent - 是否为重音
   */
  showWaveform(isAccent) {
    if (!this.canvas || !this.canvasCtx) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const ctx = this.canvasCtx;

    try {
      // 完全清除画布
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(0, 0, width, height);
  
      // 绘制网格
      this.drawGrid(ctx, width, height);
  
      // 计算时间参数
      const attackTime = isAccent ? 0.01 : 0.03;
      const decayTime = this.decay / 1000;
      const totalDuration = attackTime + (isAccent ? decayTime * 1.5 : decayTime);
      
      // 采样参数
      const sampleRate = 88200; // 提高采样率以获得更精确的波形
      const numSamples = Math.floor(totalDuration * sampleRate);
      
      // 创建缓冲区
      const buffer = new Float32Array(numSamples);
      
      // 根据不同波形调整音量
      let baseVolume;
      switch (this.waveform) {
        case 'sine':
          baseVolume = isAccent ? this.volume * 1.8 : this.volume * 0.9;
          break;
        case 'square':
          baseVolume = isAccent ? this.volume * 1.4 : this.volume * 0.7;
          break;
        case 'triangle':
          baseVolume = isAccent ? this.volume * 1.6 : this.volume * 0.8;
          break;
        case 'sawtooth':
          baseVolume = isAccent ? this.volume * 1.5 : this.volume * 0.75;
          break;
        default:
          baseVolume = isAccent ? this.volume * 1.6 : this.volume * 0.8;
      }
      
      // 频率参数
      const angularFrequency = 2 * Math.PI * this.frequency;
      const detuneRatio = isAccent ? 1.006 : 1.0;
      
      // 应用失谐
      const detuneAmount = this.detune.enabled ? this.detune.amount : 0;
      const detuneFactor = Math.pow(2, detuneAmount / 1200); // 音分到频率比转换
      
      // 谐波控制
      const harmonicsAmount = this.harmonics.enabled ? this.harmonics.amount : 0;
      const harmonicsRatio = this.harmonics.ratio || [1, 0.5, 0.25, 0.125];
      
      // 波形生成参数
      const harmonicsCount = {
        square: 15,
        sawtooth: 10
      };
      
      // 生成音频数据
      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        
        // 生成基本波形
        let sample = this._generateBasicWaveform(t, angularFrequency, detuneRatio * detuneFactor);
        
        // 应用谐波增强
        if (harmonicsAmount > 0) {
          sample = this._applyHarmonics(sample, t, angularFrequency, detuneRatio * detuneFactor, harmonicsAmount, harmonicsRatio);
        }
        
        // 应用包络
        const normalizedTime = t / totalDuration;
        let envelope = this._calculateEnvelope(normalizedTime, isAccent, baseVolume);
        
        // 应用滤波器包络调制
        if (this.filter.envelope.enabled) {
          const filterEnvelopeValue = this._calculateFilterEnvelope(normalizedTime, totalDuration);
          sample = this._applyFilterEnvelope(sample, filterEnvelopeValue, this.filter.envelope.amount);
        }
        
        // 应用失真
        if (this.distortion.enabled && this.distortion.amount > 0) {
          sample = this._applyDistortion(sample, this.distortion.amount, this.distortion.type);
        }
        
        buffer[i] = sample * envelope;
      }
  
      // 应用平滑处理，减少锯齿
      this._applySmoothing(buffer, 3);
      
      // 绘制波形
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#f59e0b';
      
      // 显示参数优化
      const maxDisplayTime = 0.03; // 显示30ms的波形
      const displayDuration = Math.min(totalDuration, maxDisplayTime);
      const displaySamples = Math.floor(displayDuration * sampleRate);
      const sliceWidth = width / displaySamples;
      
      // 计算有效显示区域
      const bottomPadding = 24;
      const effectiveHeight = height - bottomPadding;
      
      // 波形显示优化
      const centerY = effectiveHeight / 2;
      const displayScale = isAccent ? 2.5 : 1.5;
      const scaleY = effectiveHeight / (displayScale * 1.2);
      
      // 平滑处理
      const smoothingFactor = 3;
      const smoothBuffer = new Float32Array(displaySamples);
      
      // 加权平滑处理
      for (let i = 0; i < displaySamples; i++) {
        let sum = 0;
        let totalWeight = 0;
        
        for (let j = Math.max(0, i - smoothingFactor); j <= Math.min(displaySamples - 1, i + smoothingFactor); j++) {
          // 高斯权重
          const weight = Math.exp(-Math.pow(j - i, 2) / (2 * Math.pow(smoothingFactor/2, 2)));
          sum += buffer[j] * weight;
          totalWeight += weight;
        }
        
        smoothBuffer[i] = sum / totalWeight;
      }
      
      // 自动调整缩放比例
      let maxAmplitude = 0;
      for (let i = 0; i < displaySamples; i++) {
        maxAmplitude = Math.max(maxAmplitude, Math.abs(smoothBuffer[i]));
      }
      
      // 动态缩放
      const dynamicScale = Math.min(scaleY, effectiveHeight / (2.4 * maxAmplitude));
      
      // 使用Path2D优化绘制
      const path = new Path2D();
      let x = 0;
      
      for (let i = 0; i < displaySamples; i++) {
        const v = smoothBuffer[i];
        const y = centerY + (v * dynamicScale);
  
        if (i === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
  
        x += sliceWidth;
      }
  
      ctx.stroke(path);
  
      // 绘制频谱
      this._drawSpectrum(ctx, buffer, effectiveHeight, width, isAccent);
  
      // 绘制刻度
      this.drawScale(ctx, width, height, displayDuration, isAccent);
      
      // 绘制高级参数状态
      this._drawAdvancedParamsStatus(ctx, width, height);
    } catch (error) {
      console.error('波形显示错误:', error);
      // 绘制错误提示
      ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
      ctx.fillRect(0, 0, width, 30);
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('波形显示错误', width/2, 20);
    }
  }
  
  /**
   * 绘制高级参数状态
   * @private
   * @param {CanvasRenderingContext2D} ctx - 画布上下文
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  _drawAdvancedParamsStatus(ctx, width, height) {
    // 只在有启用高级参数的情况下显示
    if (!(this.harmonics.enabled || this.detune.enabled || 
          this.filter.envelope.enabled || this.distortion.enabled || 
          this.stereo.enabled)) {
      return;
    }
    
    ctx.textAlign = 'left';
    ctx.font = '10px Arial';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    
    let y = 16;
    const lineHeight = 12;
    const maxWidth = 100;
    
    // 绘制启用的高级参数状态
    if (this.harmonics.enabled) {
      ctx.fillText(`谐波: ${(this.harmonics.amount * 100).toFixed(0)}%`, 8, y);
      y += lineHeight;
    }
    
    if (this.detune.enabled) {
      ctx.fillText(`失谐: ${this.detune.amount.toFixed(1)}cent`, 8, y);
      y += lineHeight;
    }
    
    if (this.filter.envelope.enabled) {
      ctx.fillText(`滤波器包络: ${(this.filter.envelope.amount * 100).toFixed(0)}%`, 8, y);
      y += lineHeight;
    }
    
    if (this.distortion.enabled) {
      ctx.fillText(`失真(${this.distortion.type}): ${(this.distortion.amount * 100).toFixed(0)}%`, 8, y);
      y += lineHeight;
    }
    
    if (this.stereo.enabled) {
      const panText = this.stereo.pan === 0 ? 'C' : 
                      this.stereo.pan < 0 ? `L${Math.abs(this.stereo.pan * 100).toFixed(0)}` : 
                      `R${(this.stereo.pan * 100).toFixed(0)}`;
      ctx.fillText(`立体声: ${panText} ${(this.stereo.width * 100).toFixed(0)}%`, 8, y);
    }
  }
  
  /**
   * 绘制频谱
   * @private
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {Float32Array} buffer - 音频数据
   * @param {number} effectiveHeight - 有效高度
   * @param {number} width - 画布宽度
   * @param {boolean} isAccent - 是否为重音
   */
  _drawSpectrum(ctx, buffer, effectiveHeight, width, isAccent) {
    // 计算频谱
    const fftSize = 2048;
    const fft = new Float32Array(fftSize);
    
    // 复制数据到FFT缓冲区
    for (let i = 0; i < fftSize; i++) {
      fft[i] = buffer[i % buffer.length];
    }
    
    // 计算频谱
    const spectrum = this.calculateSpectrum(fft);
    
    // 频率范围参数
    const sampleRate = 44100;
    const nyquistFreq = sampleRate / 2;
    
    // 调整频率范围，从10Hz开始显示
    const minFreqLog = Math.log2(10); // 从10Hz开始
    const maxFreqLog = Math.log2(nyquistFreq / 2); // 显示到奈奎斯特频率的一半
    const freqLogRange = maxFreqLog - minFreqLog;
    
    // 查找主频点
    let mainPeakIndex = 0;
    let mainPeakValue = 0;
    
    for (let i = 0; i < spectrum.length / 4; i++) {
      if (spectrum[i] > mainPeakValue) {
        mainPeakValue = spectrum[i];
        mainPeakIndex = i;
      }
    }
    
    // 主频对应的频率
    const mainPeakFreq = mainPeakIndex * nyquistFreq / fftSize;
    
    // 对频谱数据进行平滑处理
    const maxFreqIndex = Math.floor(spectrum.length / 4);
    const smoothSpectrum = new Float32Array(maxFreqIndex);
    const smoothFactor = 2;
    
    for (let i = 0; i < maxFreqIndex; i++) {
      let sum = 0;
      let totalWeight = 0;
      
      for (let j = Math.max(0, i - smoothFactor); j <= Math.min(maxFreqIndex - 1, i + smoothFactor); j++) {
        const weight = 1 - Math.abs(j - i) / (smoothFactor + 1);
        sum += spectrum[j] * weight;
        totalWeight += weight;
      }
      
      smoothSpectrum[i] = sum / totalWeight;
    }
    
    // 绘制频谱
    for (let i = 0; i < maxFreqIndex; i++) {
      // 计算频率
      const freq = i * nyquistFreq / fftSize;
      
      // 对频率应用对数比例
      if (freq <= 0) continue;
      
      const logValue = Math.log2(freq);
      if (logValue < minFreqLog) continue;
      
      const logIndex = (logValue - minFreqLog) / freqLogRange;
      if (logIndex > 1) continue;
      
      // 对振幅应用压缩
      const heightScale = Math.pow(smoothSpectrum[i], 0.5);
      const barHeight = heightScale * (effectiveHeight / 4);
      
      if (barHeight <= 0.5) continue;
      
      // 计算颜色
      const isMainPeak = Math.abs(i - mainPeakIndex) <= 1;
      const alpha = 0.1 + (heightScale * 0.4);
      let hue = 35 + (heightScale * 15);
      
      // 主频使用不同颜色
      if (isMainPeak) {
        hue = 15; // 更红的色调
      }
      
      ctx.fillStyle = `hsla(${hue}, 92%, 52%, ${alpha})`;
      
      // 计算位置和宽度
      const x = width * logIndex;
      const w = Math.max(2, width / 100 * (1 - logIndex * 0.2));
      
      // 绘制频谱条
      const radius = Math.min(w / 3, barHeight / 3);
      this.drawRoundedBar(ctx, x, effectiveHeight, w, barHeight, radius);
    }
    
    // 标记主频
    if (mainPeakValue > 0.3) {
      const logIndex = (Math.log2(mainPeakFreq) - minFreqLog) / freqLogRange;
      if (logIndex >= 0 && logIndex <= 1) {
        const x = width * logIndex;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '10px Arial';
        ctx.textAlign = 'center';
        
        // 显示主频值
        ctx.fillText(`${Math.round(mainPeakFreq)}Hz`, x, effectiveHeight - 5);
      }
    }
  }

  /**
   * 计算频谱
   * @param {Float32Array} buffer - 音频数据
   * @returns {Float32Array} - 频谱数据
   */
  calculateSpectrum(buffer) {
    try {
      const fftSize = buffer.length;
      const spectrum = new Float32Array(fftSize / 2);
      
      // 应用窗函数减少频谱泄漏
      const window = new Float32Array(fftSize);
      for (let i = 0; i < fftSize; i++) {
        // 布莱克曼窗
        const a0 = 0.42;
        const a1 = 0.5;
        const a2 = 0.08;
        window[i] = a0 - a1 * Math.cos(2 * Math.PI * i / (fftSize - 1)) 
                     + a2 * Math.cos(4 * Math.PI * i / (fftSize - 1));
      }
      
      // 计算FFT
      for (let i = 0; i < fftSize / 2; i++) {
        let real = 0;
        let imag = 0;
        
        // 优化三角函数计算
        const angleStep = 2 * Math.PI * i / fftSize;
        let angle = 0;
        
        for (let j = 0; j < fftSize; j++) {
          const cosAngle = Math.cos(angle);
          const sinAngle = Math.sin(angle);
          real += buffer[j] * window[j] * cosAngle;
          imag -= buffer[j] * window[j] * sinAngle;
          angle += angleStep;
        }
        
        // 计算幅度
        const magnitude = Math.sqrt(real * real + imag * imag) / fftSize;
        
        // 应用频率修正
        const frequencyCorrection = this._getFrequencyWeighting(i, fftSize, 44100);
        spectrum[i] = magnitude * frequencyCorrection;
      }
      
      // 对数压缩
      for (let i = 0; i < spectrum.length; i++) {
        spectrum[i] = Math.log10(1 + 100 * spectrum[i]);
      }
      
      // 归一化
      let max = Number.EPSILON;
      for (let i = 0; i < spectrum.length; i++) {
        max = Math.max(max, spectrum[i]);
      }
      
      for (let i = 0; i < spectrum.length; i++) {
        spectrum[i] /= max;
      }
      
      return spectrum;
    } catch (error) {
      console.error('频谱计算错误:', error);
      return new Float32Array(buffer.length / 2).fill(0);
    }
  }
  
  /**
   * 获取频率加权系数，增强显示效果
   * @private
   * @param {number} index - 频率索引
   * @param {number} fftSize - FFT大小
   * @param {number} sampleRate - 采样率
   * @returns {number} - 加权系数
   */
  _getFrequencyWeighting(index, fftSize, sampleRate) {
    // 计算频率
    const frequency = index * sampleRate / fftSize;
    
    // 简化的A加权曲线，增强中频显示
    if (frequency < 20) return 0.01;
    if (frequency < 100) return 0.2 + (frequency - 20) / 80 * 0.4;
    if (frequency < 500) return 0.6 + (frequency - 100) / 400 * 0.4;
    if (frequency < 1000) return 1.0;
    if (frequency < 5000) return 1.0 - (frequency - 1000) / 4000 * 0.2;
    if (frequency < 10000) return 0.8 - (frequency - 5000) / 5000 * 0.4;
    return 0.4 * (20000 - frequency) / 10000;
  }

  /**
   * 绘制网格
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   */
  drawGrid(ctx, width, height) {
    const bottomPadding = 24;
    const effectiveHeight = height - bottomPadding;
    const gridSize = 20;
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; // 降低网格透明度
    ctx.lineWidth = 1;

    // 绘制垂直线
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, effectiveHeight);
      ctx.stroke();
    }

    // 绘制水平线
    for (let y = 0; y <= effectiveHeight; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 绘制中心线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, effectiveHeight/2);
    ctx.lineTo(width, effectiveHeight/2);
    ctx.stroke();
  }

  /**
   * 绘制刻度
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {number} width - 画布宽度
   * @param {number} height - 画布高度
   * @param {number} duration - 显示持续时间
   * @param {boolean} isAccent - 是否为重音
   */
  drawScale(ctx, width, height, duration, isAccent) {
    const fontSize = 10;
    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.textAlign = 'center';
    
    // 计算底部留白区域
    const bottomPadding = 24;
    const effectiveHeight = height - bottomPadding;

    // 优化时间刻度显示
    const baseInterval = 0.005; // 5ms
    const totalDivisions = Math.ceil(duration / baseInterval);
    const maxDivisions = 10;
    
    let timeInterval = baseInterval;
    if (totalDivisions > maxDivisions) {
      const scale = Math.ceil(totalDivisions / maxDivisions);
      timeInterval = baseInterval * scale;
    }
    
    // 绘制时间刻度
    const divisions = Math.floor(duration / timeInterval);
    for (let i = 0; i <= divisions; i++) {
      const x = (width * i * timeInterval) / duration;
      const time = (i * timeInterval * 1000).toFixed(1);
      
      // 绘制刻度线
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(x, effectiveHeight - 4);
      ctx.lineTo(x, effectiveHeight);
      ctx.stroke();
      
      // 绘制时间标签
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fillText(`${time}ms`, x, height - 8);
    }

    // 根据强弱拍调整振幅刻度范围
    const displayScale = isAccent ? 2.5 : 1.5;
    const scaleY = effectiveHeight / (displayScale * 1.2);
    
    // 绘制振幅刻度
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    const scaleStep = 0.5;
    const maxScale = isAccent ? 2.0 : 1.5;
    
    for (let i = -maxScale; i <= maxScale; i += scaleStep) {
      const y = effectiveHeight/2 - (i * scaleY/maxScale);
      if (Math.abs(i) > 0.01) { // 不显示接近0的刻度
        ctx.fillText(i.toFixed(1), 25, y + 4);
      }
    }

    // 添加频率标记
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText(`${this.frequency}Hz`, width - 45, 16);
    
    // 添加时间范围标记
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillText(`${(duration * 1000).toFixed(0)}ms`, width - 5, height - 8);
  }

  /**
   * 计算包络值
   * @private
   * @param {number} normalizedTime - 归一化时间
   * @param {boolean} isAccent - 是否为重音
   * @param {number} baseVolume - 基础音量
   * @returns {number} - 包络值
   */
  _calculateEnvelope(normalizedTime, isAccent, baseVolume) {
    if (isAccent) {
      if (normalizedTime < 0.01) {
        return baseVolume * (normalizedTime / 0.01);
      } else if (normalizedTime < 0.3) {
        return baseVolume * (1 - 0.3 * (normalizedTime - 0.01) / 0.29);
      } else if (normalizedTime < 0.6) {
        return baseVolume * 0.7 * (1 - 0.3 * (normalizedTime - 0.3) / 0.3);
      } else {
        return baseVolume * 0.4 * (1 - (normalizedTime - 0.6) / 0.4);
      }
    } else {
      if (normalizedTime < 0.03) {
        return baseVolume * (normalizedTime / 0.03);
      } else if (normalizedTime < 0.4) {
        return baseVolume * (1 - 0.5 * normalizedTime / 0.4);
      } else {
        return baseVolume * 0.5 * (1 - (normalizedTime - 0.4) / 0.6);
      }
    }
  }

  /**
   * 应用平滑处理
   * @private
   * @param {Float32Array} buffer - 音频缓冲区
   * @param {number} radius - 平滑半径
   */
  _applySmoothing(buffer, radius) {
    if (!buffer || buffer.length < 2 * radius + 1) return;
    
    const tempBuffer = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      tempBuffer[i] = buffer[i];
    }
    
    // 使用加权平滑
    for (let i = radius; i < buffer.length - radius; i++) {
      let sum = 0;
      let weightSum = 0;
      
      for (let j = -radius; j <= radius; j++) {
        // 高斯权重
        const weight = Math.exp(-(j * j) / (2 * radius * radius));
        sum += tempBuffer[i + j] * weight;
        weightSum += weight;
      }
      
      buffer[i] = sum / weightSum;
    }
  }

  /**
   * 播放音符
   * @param {boolean} isAccent - 是否为重音
   * @returns {Promise<void>}
   */
  async playNote(isAccent = false) {
    try {
      // 检查音频上下文状态
      if (!this.audioContext || this.audioContext.state === 'closed') {
        console.warn('音频上下文已关闭，尝试重新初始化');
        this._initAudioContext();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (e) {
          console.warn('恢复音频上下文失败:', e);
        }
      }
      
      // 重新创建振荡器
      const recreateSuccess = this._recreateAudioNodes();
      if (!recreateSuccess) {
        throw new Error('无法创建音频节点');
      }
      
      // 应用波形设置
      this.oscillator.type = this.waveform;
      
      // 设置时间参数
      const now = this.audioContext.currentTime;
      const attackTime = isAccent ? 0.01 : 0.03;
      const decayTime = isAccent ? this.decay * 1.5 / 1000 : this.decay / 1000;
      
      // 设置频率 (应用失谐)
      let mainFreq = this.frequency;
      if (this.detune.enabled) {
        const detuneAmount = this.detune.amount;
        const centsFactor = Math.pow(2, detuneAmount / 1200); // 音分到频率比转换
        mainFreq = this.frequency * centsFactor;
      }
      this.oscillator.frequency.setValueAtTime(mainFreq, now);
      
      // 设置音量包络
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(
        isAccent ? this.volume * 2.0 : this.volume * 0.8, 
        now + attackTime
      );
      this.gainNode.gain.exponentialRampToValueAtTime(0.001, now + attackTime + decayTime);
      
      // 应用滤波器设置
      this._applyFilterSettings(isAccent, now, attackTime, decayTime);
      
      // 应用立体声设置
      if (this.stereo.enabled && this.stereoPannerNode) {
        const panValue = this.stereo.pan;
        this.stereoPannerNode.pan.setValueAtTime(panValue, now);
        
        // 如果是重音，可以增加立体声宽度感
        if (isAccent && this.stereo.width > 0) {
          const widthFactor = this.stereo.width * 0.5;
          const targetPan = panValue + (panValue >= 0 ? widthFactor : -widthFactor);
          this.stereoPannerNode.pan.linearRampToValueAtTime(targetPan, now + attackTime);
          this.stereoPannerNode.pan.linearRampToValueAtTime(panValue, now + attackTime + decayTime * 0.7);
        }
      }
      
      // 应用谐波设置
      if (this.harmonics.enabled && this.harmonicsGainNode) {
        this.harmonicsGainNode.gain.setValueAtTime(this.harmonics.amount, now);
      }
      
      // 应用失真设置
      if (this.distortion.enabled && this.distortionNode) {
        this._createDistortionCurve(isAccent ? this.distortion.amount * 1.5 : this.distortion.amount);
      }
      
      // 停止可视化
      this.stopVisualization();
      
      // 设置播放结束处理
      return new Promise((resolve, reject) => {
        const stopTime = now + attackTime + decayTime;
        const timeoutMs = (attackTime + decayTime) * 1000 + 50; // 额外增加50ms确保完全播放
        
        const timer = setTimeout(() => {
          try {
            this.showWaveform(isAccent);
            resolve();
          } catch (error) {
            console.error('播放结束处理失败:', error);
            reject(error);
          }
        }, timeoutMs);
        
        // 添加错误处理
        this.oscillator.onerror = (error) => {
          clearTimeout(timer);
          console.error('振荡器错误:', error);
          reject(error);
        };
      });
    } catch (error) {
      console.error('播放音符失败:', error);
      // 重置音频上下文
      this._resetOnError();
      throw error;
    }
  }

  /**
   * 应用波形特定的滤波器设置
   * @private
   * @param {boolean} isAccent - 是否为重音
   * @param {number} now - 当前音频时间
   * @param {number} attackTime - 起音时间
   * @param {number} decayTime - 衰减时间
   */
  _applyFilterSettings(isAccent, now, attackTime, decayTime) {
    // 获取基础参数
    const baseFreq = this.getBaseFilterFrequency();
    const baseQ = this.getBaseFilterQ();
    
    // 清除之前的设置
    this.filterNode.frequency.cancelScheduledValues(now);
    this.filterNode.Q.cancelScheduledValues(now);
    if (this.filterNode.gain) {
      this.filterNode.gain.cancelScheduledValues(now);
    }
    
    // 根据波形应用不同的设置
    switch (this.waveform) {
      case 'sine':
        // 正弦波使用高通透设置
        this.filterNode.type = 'lowpass';
        this.filterNode.frequency.setValueAtTime(baseFreq, now);
        this.filterNode.Q.setValueAtTime(baseQ, now);
        break;
        
      case 'square':
        // 方波使用动态低通滤波
        this.filterNode.type = 'lowpass';
        const squareFreqStart = isAccent ? baseFreq * 1.2 : baseFreq;
        const squareFreqEnd = isAccent ? baseFreq * 0.4 : baseFreq * 0.6;
        
        this.filterNode.frequency.setValueAtTime(squareFreqStart, now);
        this.filterNode.frequency.exponentialRampToValueAtTime(squareFreqEnd, now + attackTime + decayTime * 0.5);
        
        // 动态Q值变化增强特性
        this.filterNode.Q.setValueAtTime(baseQ * (isAccent ? 1.5 : 1.0), now);
        this.filterNode.Q.linearRampToValueAtTime(baseQ * 0.5, now + attackTime + decayTime * 0.7);
        break;
        
      case 'triangle':
        // 三角波使用带通滤波增强中频特性
        this.filterNode.type = 'bandpass';
        this.filterNode.frequency.setValueAtTime(baseFreq * 0.8, now);
        this.filterNode.frequency.linearRampToValueAtTime(baseFreq * 1.2, now + attackTime);
        this.filterNode.frequency.linearRampToValueAtTime(baseFreq * 0.9, now + attackTime + decayTime);
        
        this.filterNode.Q.setValueAtTime(baseQ * (isAccent ? 1.2 : 1.0), now);
        break;
        
      case 'sawtooth':
        // 锯齿波使用峰值滤波增强特征频率
        this.filterNode.type = 'peaking';
        this.filterNode.frequency.setValueAtTime(baseFreq * (isAccent ? 0.8 : 0.7), now);
        
        this.filterNode.Q.setValueAtTime(baseQ * (isAccent ? 1.5 : 1.2), now);
        this.filterNode.Q.linearRampToValueAtTime(baseQ * 0.8, now + attackTime + decayTime * 0.5);
        
        // 设置增益
        if (this.filterNode.gain) {
          const peakGain = isAccent ? 8 : 6;
          this.filterNode.gain.setValueAtTime(peakGain, now);
          this.filterNode.gain.linearRampToValueAtTime(1, now + attackTime + decayTime * 0.7);
        }
        break;
    }
  }

  /**
   * 发生错误时重置音频上下文
   * @private
   */
  _resetOnError() {
    try {
      // 停止振荡器
      if (this.oscillator) {
        this.oscillator.stop();
      }
      
      // 关闭现有上下文
      if (this.audioContext) {
        this.audioContext.close();
      }
      
      // 延迟重新初始化
      setTimeout(() => this._initAudioContext(), 500);
    } catch (error) {
      console.error('重置音频上下文失败:', error);
    }
  }

  /**
   * 获取基础滤波器频率
   * @returns {number} - 基础滤波器频率
   */
  getBaseFilterFrequency() {
    switch (this.waveform) {
      case 'sine':
        return 8000; // 正弦波保持高频透明度
      case 'square':
        return 3000; // 方波需要较低的截止频率来塑造音色
      case 'triangle':
        return 2000; // 三角波需要中频增强
      case 'sawtooth':
        return 1200; // 锯齿波需要较低的峰值频率
      default:
        return 4000;
    }
  }

  /**
   * 获取基础滤波器Q值
   * @returns {number} - 基础滤波器Q值
   */
  getBaseFilterQ() {
    switch (this.waveform) {
      case 'sine':
        return 0.5; // 正弦波使用平滑的滤波
      case 'square':
        return 8;   // 方波需要尖锐的滤波来塑造特征
      case 'triangle':
        return 3;   // 三角波使用中等的Q值
      case 'sawtooth':
        return 5;   // 锯齿波需要较高的Q值来突出特征
      default:
        return 1;
    }
  }

  /**
   * 绘制圆角频谱条
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {number} x - x坐标
   * @param {number} y - y坐标
   * @param {number} width - 宽度
   * @param {number} height - 高度
   * @param {number} radius - 圆角半径
   */
  drawRoundedBar(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y - radius);
    ctx.lineTo(x + width, y - height + radius);
    ctx.quadraticCurveTo(x + width, y - height, x + width - radius, y - height);
    ctx.lineTo(x + radius, y - height);
    ctx.quadraticCurveTo(x, y - height, x, y - height + radius);
    ctx.lineTo(x, y - radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.fill();
  }

  /**
   * 清理资源
   */
  destroy() {
    try {
      // 停止可视化
      this.stopVisualization();
      
      // 断开并清理所有音频节点
      if (this.oscillator) {
        this.oscillator.stop();
        this.oscillator.disconnect();
      }
      
      if (this.gainNode) {
        this.gainNode.disconnect();
      }
      
      if (this.filter) {
        this.filter.disconnect();
      }
      
      // 关闭音频上下文
      if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close();
      }
      
      // 清空引用
      this.oscillator = null;
      this.gainNode = null;
      this.filter = null;
      this.audioContext = null;
      this.canvas = null;
      this.canvasCtx = null;
    } catch (error) {
      console.error('清理资源时发生错误:', error);
    }
  }
}

module.exports = AudioSynthesizer; 