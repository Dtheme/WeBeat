Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    rhythmPatterns: {
      type: Array,
      value: []
    },
    rhythmCategories: {
      type: Array,
      value: []
    },
    currentRhythm: {
      type: Object,
      value: null
    },
    rhythmIntensity: {
      type: Number,
      value: 0.5
    }
  },

  data: {
    activeCategory: 'basic',
    filterPatterns: [],
    showIntensityControl: false,
    categoryDescription: '',
    currentPlayingRhythmId: '',
    currentPlayingBeat: -1,
    playingTimer: null,
    autoStopTimer: null,
    _animationStartTime: null
  },

  observers: {
    'visible, rhythmPatterns, activeCategory': function() {
      this.filterRhythmPatterns();
    },
    'rhythmCategories, activeCategory': function() {
      this.updateCategoryDescription();
    },
    'currentRhythm': function(rhythm) {
      if (rhythm && rhythm.category) {
        console.log('[Debug] 当前节奏类型:', rhythm.category, '是否显示强度控制:', rhythm.category === 'swing' || rhythm.category === 'shuffle');
        
        // 确定是否显示强度控制
        const showControl = rhythm.category === 'swing' || rhythm.category === 'shuffle';
        
        this.setData({
          // 显示强度控制：仅对swing或shuffle类型
          showIntensityControl: showControl,
          activeCategory: rhythm.category
        });
        
        console.log('[Debug] 强度控制状态已更新:', showControl);
      } else {
        this.setData({
          showIntensityControl: false
        });
        console.log('[Debug] 强度控制已隐藏：未选中节奏或不是可调节的类型');
      }
    },
    'visible': function(visible) {
      // 当组件隐藏时，停止所有播放动画
      if (!visible) {
        this.stopPlayingAnimation();
      } else {
        // 当组件显示时，检查当前分类是否为swing或shuffle，以决定是否显示强度控制器
        const category = this.data.activeCategory;
        const showIntensityControl = category === 'swing' || category === 'shuffle';
        
        console.log('[Debug] 组件显示，当前分类:', category, '显示强度控制:', showIntensityControl);
        
        // 如果当前是swing或shuffle分类，则显示强度控制器
        if (showIntensityControl) {
          this.setData({
            showIntensityControl: true
          });
        }
      }
    }
  },

  methods: {
    // 更新当前分类的描述
    updateCategoryDescription() {
      if (!this.data.rhythmCategories || this.data.rhythmCategories.length === 0) return;
      
      const category = this.data.rhythmCategories.find(item => item.id === this.data.activeCategory);
      if (category) {
        this.setData({
          categoryDescription: category.description || ''
        });
      }
    },
    
    // 关闭弹窗
    onClose() {
      this.stopPlayingAnimation();
      this.triggerEvent('close');
    },
    
    // 防止点击内容区域时关闭
    stopPropagation() {
      // 阻止冒泡
    },
    
    // 切换分类
    switchCategory(e) {
      // 切换分类时停止播放
      this.stopPlayingAnimation();
      
      const category = e.currentTarget.dataset.category;
      
      // 检查是否需要显示强度控制
      const showIntensityControl = category === 'swing' || category === 'shuffle';
      
      this.setData({ 
        activeCategory: category,
        showIntensityControl: showIntensityControl
      });

      // 延迟滚动操作，确保分类已经切换
      if (showIntensityControl) {
        setTimeout(() => {
          // 确保滑块的值正确显示
          const intensity = this.data.rhythmIntensity;
          console.log('[Debug] 显示强度控制，当前强度值:', intensity);
        }, 50);
      }
      
      console.log('[Debug] 切换分类:', category, '显示强度控制:', showIntensityControl);
    },
    
    // 过滤当前分类下的节奏型
    filterRhythmPatterns() {
      if (!this.data.visible || !this.data.rhythmPatterns) return;
      
      const patterns = this.data.rhythmPatterns;
      const category = this.data.activeCategory;
      const currentRhythmId = this.data.currentRhythm ? this.data.currentRhythm.id : '';
      const currentPlayingRhythmId = this.data.currentPlayingRhythmId;
      
      const filtered = patterns.filter(pattern => pattern.category === category)
        .map(pattern => ({
          ...pattern,
          isSelected: pattern.id === currentRhythmId,
          isPlaying: pattern.id === currentPlayingRhythmId
        }));
        
      this.setData({ filterPatterns: filtered });
    },
    
    // 选择节奏型
    onSelect(e) {
      const rhythmId = e.currentTarget.dataset.id;
      const rhythm = this.data.rhythmPatterns.find(pattern => pattern.id === rhythmId);
      
      if (rhythm) {
        console.log('[Debug] 选择节奏型:', rhythm.name, rhythm.id, '类别:', rhythm.category);
        
        // 确定是否需要显示强度控制
        const showControl = rhythm.category === 'swing' || rhythm.category === 'shuffle';
        console.log('[Debug] 是否需要显示强度控制:', showControl);
        
        // 更新选中状态
        const filtered = this.data.filterPatterns.map(pattern => ({
          ...pattern,
          isSelected: pattern.id === rhythmId
        }));
        
        this.setData({
          filterPatterns: filtered,
          currentRhythm: rhythm,
          // 立即更新强度控制的显示状态
          showIntensityControl: showControl
        });
        
        console.log('[Debug] 已更新组件数据，强度控制显示状态:', showControl);
        
        // 通知父组件选中的节奏型ID
        this.triggerEvent('select', { rhythmId });
        
        // 停止任何正在进行的试听
        this.stopPlayingAnimation();
      }
    },
    
    // 开始节奏动画
    startRhythmAnimation(rhythmId) {
      // 先停止当前播放的动画
      this.stopPlayingAnimation();
      
      // 找到要播放的节奏型
      const rhythm = this.data.rhythmPatterns.find(p => p.id === rhythmId);
      if (!rhythm) return;
      
      // 更新播放状态
      const filtered = this.data.filterPatterns.map(pattern => ({
        ...pattern,
        isPlaying: pattern.id === rhythmId
      }));
      
      this.setData({
        filterPatterns: filtered,
        currentPlayingRhythmId: rhythmId,
        currentPlayingBeat: 0
      });
      
      // 对于Swing和Shuffle节奏使用特殊播放方法
      if (rhythm.category === 'swing' || rhythm.category === 'shuffle') {
        this.playSwingRhythm(rhythm);
        return;
      }
      
      // 其他节奏类型使用标准播放方法
      this.playStandardRhythm(rhythm);
    },
    
    // 播放标准节奏型
    playStandardRhythm(rhythm) {
      const rhythmId = rhythm.id;
      console.log('[Debug] 开始播放标准节奏:', rhythmId);
      
      // 计算播放速度 (默认速度120BPM)
      const bpm = 120;
      // 根据节奏模式计算合适的播放速度
      let baseBeatDuration = 60000 / bpm;
      
      // 根据节奏类型调整播放速度
      if (rhythm.category === 'latin' || rhythm.category === 'funk') {
        // 拉丁和放克节奏通常更快
        baseBeatDuration = baseBeatDuration * 0.75;
      }
      
      console.log(`[Debug] 基础节拍间隔: ${baseBeatDuration}ms`);
      
      // 获取节奏模式，确保它是有效的数组
      const pattern = rhythm.pattern && rhythm.pattern.length > 0 ? rhythm.pattern : [1, 0];
      
      // 安全检查：确保模式数组有至少一个元素
      if (!pattern || pattern.length === 0) {
        console.error('节奏模式无效:', rhythm.id);
        return;
      }
      
      console.log('[Debug] 节奏模式:', pattern);
      
      let beat = 0;
      
      // 立即播放第一拍
      const isFirstBeatAccent = pattern[0] === 1;
      console.log(`[Debug] 播放第1拍, 重音: ${isFirstBeatAccent}, 时间: ${new Date().toISOString()}`);
      this.triggerEvent('play-beat', { isAccent: isFirstBeatAccent });
      
      this._animationStartTime = Date.now();
      
      // 创建循环定时器
      const timer = setInterval(() => {
        // 检查是否已停止
        if (this.data.currentPlayingRhythmId !== rhythmId) {
          console.log('[Debug] 节奏已更改，停止播放');
          clearInterval(timer);
          return;
        }
        
        // 前进到下一拍
        beat = (beat + 1) % pattern.length;
        
        // 更新当前播放的拍子
        this.setData({
          currentPlayingBeat: beat
        });
        
        // 播放当前拍对应的声音
        const isAccent = pattern[beat] === 1;
        console.log(`[Debug] 播放第${beat+1}拍, 重音: ${isAccent}, 时间: ${new Date().toISOString()}, 间隔: ${baseBeatDuration}ms`);
        this.triggerEvent('play-beat', { isAccent });
        
        // 检查是否超过了最大播放时间(10秒)
        const now = Date.now();
        if (now - this._animationStartTime > 10000) {
          console.log('[Debug] 试听超时，自动停止');
          clearInterval(timer);
          this.stopPlayingAnimation();
          this.triggerEvent('test-stop', { rhythmId });
          return;
        }
      }, baseBeatDuration);
      
      this.data.playingTimer = timer;
      
      // 设置自动停止定时器(10秒后)
      const autoStopTimer = setTimeout(() => {
        console.log('[Debug] 试听时间结束，自动停止');
        if (this.data.currentPlayingRhythmId === rhythmId) {
          clearInterval(timer);
          this.stopPlayingAnimation();
          this.triggerEvent('test-stop', { rhythmId });
        }
      }, 10000);
      
      this.data.autoStopTimer = autoStopTimer;
    },
    
    // 播放Swing/Shuffle特殊节奏
    playSwingRhythm(rhythm) {
      const rhythmId = rhythm.id;
      console.log('[Debug] 开始播放Swing节奏:', rhythmId);
      
      // 计算基础播放速度 (默认速度110BPM，略慢于标准节奏)
      const bpm = 110;
      const baseBeatDuration = 60000 / bpm;
      console.log(`[Debug] 基础节拍间隔: ${baseBeatDuration}ms`);
      
      // 获取节奏模式，确保它是有效的数组
      const pattern = rhythm.pattern && rhythm.pattern.length > 0 ? rhythm.pattern : [1, 0];
      
      // 安全检查：确保模式数组有至少一个元素
      if (!pattern || pattern.length === 0) {
        console.error('节奏模式无效:', rhythm.id);
        return;
      }
      
      console.log('[Debug] 节奏模式:', pattern, '长度:', pattern.length);
      
      // 获取摇摆/舞曲强度
      const intensity = this.data.rhythmIntensity || 0.5;
      // 确保强度是0-1之间的值
      const normalizedIntensity = intensity > 1 ? intensity/100 : intensity;
      console.log(`[Debug] 摇摆强度: ${Math.round(normalizedIntensity*100)}`);
      
      // 初始化节拍位置
      let beat = 0;
      
      // 立即播放第一拍
      const isFirstBeatAccent = pattern[0] === 1;
      console.log(`[Debug] 播放第1拍, 重音: ${isFirstBeatAccent}, 时间: ${new Date().toISOString()}`);
      this.triggerEvent('play-beat', { isAccent: isFirstBeatAccent });
      
      // 记录开始时间
      this._animationStartTime = Date.now();
      
      // 简化Swing播放逻辑，使用固定的间隔序列
      const swingBeatCount = pattern.length;
      let nextBeatScheduled = false;
      
      // 用于记录偏差修正
      let timeCorrection = 0;
      
      // 安排下一拍的播放
      const playNextBeat = () => {
        if (nextBeatScheduled) return;
        
        // 标记为已安排
        nextBeatScheduled = true;
        
        // 增加拍子位置
        beat = (beat + 1) % swingBeatCount;
        
        // 计算当前拍子是否为重音
        const isAccent = pattern[beat] === 1;
        
        // 更新UI显示
        this.setData({
          currentPlayingBeat: beat
        });
        
        const currentTime = new Date().toISOString();
        
        // 播放声音
        this.triggerEvent('play-beat', { isAccent });
        
        // 计算下一拍间隔时间
        let nextBeatDelay;
        if (beat % 2 === 0) {
          // 强拍位置的间隔(下一拍是弱拍)
          nextBeatDelay = baseBeatDuration * (1 + normalizedIntensity * 0.5);
        } else {
          // 弱拍位置的间隔(下一拍是强拍)
          nextBeatDelay = baseBeatDuration * (1 - normalizedIntensity * 0.5);
        }
        
        // 应用时间修正
        nextBeatDelay += timeCorrection;
        timeCorrection = 0; // 重置修正
        
        // 确保间隔始终为正值
        nextBeatDelay = Math.max(10, nextBeatDelay);
        
        console.log(`[Debug] 播放第${beat+1}拍, 重音: ${isAccent}, 时间: ${currentTime}, 下一拍间隔: ${nextBeatDelay}ms`);
        
        // 检查是否超时
        if (Date.now() - this._animationStartTime > 10000) {
          console.log('[Debug] 试听超时，自动停止');
          this.stopPlayingAnimation();
          this.triggerEvent('test-stop', { rhythmId });
          return;
        }
        
        // 检查是否已停止播放
        if (this.data.currentPlayingRhythmId !== rhythmId) {
          console.log('[Debug] 节奏已更改，停止播放');
          return;
        }
        
        // 记录调度时间
        const scheduledTime = Date.now();
        
        // 设置下一拍定时器
        const timerId = setTimeout(() => {
          // 计算与预期时间的差异
          const actualDelay = Date.now() - scheduledTime;
          const diff = actualDelay - nextBeatDelay;
          
          // 如果差异大于5ms，则在下一拍中修正
          if (Math.abs(diff) > 5) {
            timeCorrection = -diff;
          }
          
          console.log(`[Debug] 实际延迟: ${actualDelay}ms, 预期: ${nextBeatDelay}ms, 差异: ${diff}ms`);
          
          nextBeatScheduled = false;
          playNextBeat();
        }, nextBeatDelay);
        
        // 保存定时器ID
        this.data.playingTimer = timerId;
      };
      
      // 安排第一拍后的第二拍
      const initialDelay = Math.max(10, baseBeatDuration * (1 - normalizedIntensity * 0.3));
      console.log(`[Debug] 安排第2拍, 延迟: ${initialDelay}ms`);
      const initialTimer = setTimeout(() => {
        playNextBeat();
      }, initialDelay);
      
      this.data.playingTimer = initialTimer;
      
      // 设置自动停止定时器(10秒后)
      const autoStopTimer = setTimeout(() => {
        console.log('[Debug] 试听时间结束，自动停止');
        if (this.data.currentPlayingRhythmId === rhythmId) {
          this.stopPlayingAnimation();
          this.triggerEvent('test-stop', { rhythmId });
        }
      }, 10000);
      
      this.data.autoStopTimer = autoStopTimer;
    },
    
    // 停止所有播放动画
    stopPlayingAnimation() {
      console.log('[Debug] 停止播放动画, 时间:', new Date().toISOString());
      
      // 清除定时器 - 既可能是interval也可能是timeout
      if (this.data.playingTimer) {
        console.log('[Debug] 清除播放定时器, ID:', this.data.playingTimer);
        clearTimeout(this.data.playingTimer);
        clearInterval(this.data.playingTimer);
        this.data.playingTimer = null;
      }
      
      if (this.data.autoStopTimer) {
        console.log('[Debug] 清除自动停止定时器, ID:', this.data.autoStopTimer);
        clearTimeout(this.data.autoStopTimer);
        this.data.autoStopTimer = null;
      }
      
      // 获取当前播放的节奏ID
      const currentId = this.data.currentPlayingRhythmId;
      console.log('[Debug] 当前播放的节奏ID:', currentId);
      
      // 更新UI状态
      const filtered = this.data.filterPatterns.map(pattern => ({
        ...pattern,
        isPlaying: false
      }));
      
      this.setData({
        filterPatterns: filtered,
        currentPlayingRhythmId: '',
        currentPlayingBeat: -1
      });
      
      this._animationStartTime = null;
      console.log('[Debug] 播放动画已停止, 动画状态已重置');
    },
    
    // 试听节奏型
    onTest(e) {
      const rhythmId = e.currentTarget.dataset.id;
      console.log('[Debug] 试听按钮点击, 节奏ID:', rhythmId);
      
      // 如果当前是播放状态，则停止
      if (rhythmId === this.data.currentPlayingRhythmId) {
        console.log('[Debug] 当前节奏正在播放，停止试听');
        this.stopPlayingAnimation();
        
        // 通知父组件停止播放
        this.triggerEvent('test-stop', { rhythmId });
        return;
      }
      
      const rhythm = this.data.rhythmPatterns.find(r => r.id === rhythmId);
      if (rhythm) {
        console.log('[Debug] 找到节奏模式:', rhythm.name, '分类:', rhythm.category);
      } else {
        console.error('[Debug] 未找到对应的节奏模式:', rhythmId);
        return;
      }
      
      // 开始播放
      this.startRhythmAnimation(rhythmId);
      
      // 通知父组件播放
      this.triggerEvent('test', { rhythmId });
    },
    
    // 更改节奏强度
    onIntensityChange(e) {
      // 确保获取正确的滑块值
      const intensity = e.detail.value;
      
      console.log('[Debug] 节奏强度变化:', intensity);
      
      // 确保是0-1之间的值
      const normalizedIntensity = parseFloat(intensity);
      if (isNaN(normalizedIntensity) || normalizedIntensity < 0 || normalizedIntensity > 1) {
        console.error('[Debug] 强度值无效:', intensity);
        return;
      }
      
      // 更新组件内部数据
      this.setData({
        rhythmIntensity: normalizedIntensity
      });
      
      // 通知父组件强度变化，确保传递intensity字段
      this.triggerEvent('intensity-change', { intensity: normalizedIntensity });
      console.log('[Debug] 已触发强度变化事件, 强度值:', normalizedIntensity);
      
      // 如果当前有节奏在试听中，则应用新强度值重新播放
      if (this.data.currentPlayingRhythmId) {
        const rhythmId = this.data.currentPlayingRhythmId;
        const rhythm = this.data.rhythmPatterns.find(p => p.id === rhythmId);
        if (rhythm && (rhythm.category === 'swing' || rhythm.category === 'shuffle')) {
          // 停止当前播放，并以新强度重新播放
          this.stopPlayingAnimation();
          setTimeout(() => {
            this.startRhythmAnimation(rhythmId);
          }, 50);
        }
      }
    },
    
    // 格式化节奏型说明
    formatDescription(rhythm) {
      if (rhythm.category === 'swing' || rhythm.category === 'shuffle') {
        // 确保强度值在0-100%范围内正确显示
        const displayIntensity = this.data.rhythmIntensity > 1 ? 
          Math.round(this.data.rhythmIntensity) : 
          Math.round(this.data.rhythmIntensity * 100);
        return `${rhythm.name} - 摇摆感 ${displayIntensity}%`;
      }
      return rhythm.description || rhythm.name;
    }
  }
}) 