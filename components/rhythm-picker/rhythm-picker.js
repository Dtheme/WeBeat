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
        this.setData({
          // 显示强度控制：仅对swing或shuffle类型
          showIntensityControl: rhythm.category === 'swing' || rhythm.category === 'shuffle'
        });
      }
    },
    'visible': function(visible) {
      // 当组件隐藏时，停止所有播放动画
      if (!visible) {
        this.stopPlayingAnimation();
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
      this.setData({ activeCategory: category });
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
        this.triggerEvent('select', { rhythmId });
      }
    },
    
    // 停止所有播放动画
    stopPlayingAnimation() {
      if (this.data.playingTimer) {
        clearInterval(this.data.playingTimer);
      }
      
      const filtered = this.data.filterPatterns.map(pattern => ({
        ...pattern,
        isPlaying: false
      }));
      
      this.setData({
        filterPatterns: filtered,
        currentPlayingRhythmId: '',
        currentPlayingBeat: -1,
        playingTimer: null
      });
      
      this._animationStartTime = null;
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
      
      // 计算播放速度 (默认速度120BPM)
      const bpm = 120;
      // 根据节奏模式计算合适的播放速度
      let beatDuration = 60000 / bpm;
      
      // 根据节奏类型调整播放速度
      if (rhythm.category === 'latin' || rhythm.category === 'funk') {
        // 拉丁和放克节奏通常更快
        beatDuration = beatDuration * 0.75;
      } else if (rhythm.category === 'swing' || rhythm.category === 'shuffle') {
        // 摇摆和舞曲节奏通常更慢
        beatDuration = beatDuration * 1.2;
      }
      
      // 开始动画循环
      const pattern = rhythm.pattern;
      let beat = 0;
      
      // 立即播放第一拍
      const isFirstBeatAccent = pattern[0] === 1;
      this.triggerEvent('play-beat', { isAccent: isFirstBeatAccent });
      
      const timer = setInterval(() => {
        // 前进到下一拍
        beat = (beat + 1) % pattern.length;
        
        // 更新当前播放的拍子
        this.setData({
          currentPlayingBeat: beat
        });
        
        // 播放当前拍对应的声音
        const isAccent = pattern[beat] === 1;
        this.triggerEvent('play-beat', { isAccent });
        
        // 10秒后自动停止动画
        if (this._animationStartTime && (Date.now() - this._animationStartTime > 10000)) {
          this.stopPlayingAnimation();
          // 通知父组件停止播放
          this.triggerEvent('test-stop', { rhythmId });
        }
      }, beatDuration);
      
      this._animationStartTime = Date.now();
      this.setData({ playingTimer: timer });
    },
    
    // 试听节奏型
    onTest(e) {
      const rhythmId = e.currentTarget.dataset.id;
      
      // 如果当前是播放状态，则停止
      if (rhythmId === this.data.currentPlayingRhythmId) {
        this.stopPlayingAnimation();
        
        // 通知父组件停止播放
        this.triggerEvent('test-stop', { rhythmId });
        return;
      }
      
      // 开始播放
      this.startRhythmAnimation(rhythmId);
      
      // 通知父组件播放
      this.triggerEvent('test', { rhythmId });
    },
    
    // 更改节奏强度
    onIntensityChange(e) {
      const intensity = e.detail.value;
      this.triggerEvent('intensity-change', { intensity });
    },
    
    // 格式化节奏型说明
    formatDescription(rhythm) {
      if (rhythm.category === 'swing' || rhythm.category === 'shuffle') {
        return `${rhythm.name} - 摇摆感 ${Math.round(this.data.rhythmIntensity * 100)}%`;
      }
      return rhythm.description || rhythm.name;
    }
  }
}) 