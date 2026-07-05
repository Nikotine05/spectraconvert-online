import React, { useState, useRef, useEffect } from 'react';
import { 
  Cloud, ChevronDown, Settings, Wrench, FileText, UploadCloud, Download, CheckCircle,
  FileImage, RefreshCw, MoreVertical, Link as LinkIcon, HardDrive, Search, X, Zap, Check,
  CreditCard, Lock, ArrowRight, ShieldCheck, LogOut
} from 'lucide-react';
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

const FORMAT_GROUPS = {
  audio: ['AAC', 'AIFF', 'FLAC', 'M4A', 'MP3', 'WAV', 'WMA', 'OGG', 'OPUS'],
  video: ['MP4', 'AVI', 'MKV', 'MOV', 'WMV', 'FLV', 'WEBM', 'MPEG', '3GP'],
  image: ['JPG', 'PNG', 'WEBP', 'GIF', 'SVG', 'BMP', 'TIFF', 'ICO', 'HEIC'],
  document: ['PDF', 'DOC', 'DOCX', 'TXT', 'RTF', 'ODT', 'HTML', 'EPUB', 'MOBI'],
  archive: ['ZIP', 'RAR', '7Z', 'TAR', 'GZ', 'BZ2'],
  spreadsheet: ['XLS', 'XLSX', 'CSV', 'ODS'],
  presentation: ['PPT', 'PPTX', 'ODP']
};

const ALL_FORMATS = Object.entries(FORMAT_GROUPS).map(([category, formats]) => 
  formats.map(fmt => ({ category, name: fmt }))
).flat();



const isLive = import.meta.env.VITE_PAYPAL_ENVIRONMENT === 'live';
const clientId = isLive ? import.meta.env.VITE_PAYPAL_LIVE_CLIENT_ID : import.meta.env.VITE_PAYPAL_SANDBOX_CLIENT_ID;
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const apiUrl = (path) => `${API_BASE_URL}${path}`;
const DEFAULT_GOOGLE_CLIENT_ID = '920941311246-5f5rv8f6m05tgamq5jp4vb3b5u56m40r.apps.googleusercontent.com';

const ensureGoogleScript = () => new Promise((resolve, reject) => {
  if (window.google?.accounts?.oauth2) {
    resolve();
    return;
  }

  const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
  if (existingScript) {
    existingScript.addEventListener('load', () => resolve(), { once: true });
    existingScript.addEventListener('error', () => reject(new Error('Google login script failed to load.')), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.defer = true;
  script.onload = () => resolve();
  script.onerror = () => reject(new Error('Google login script failed to load.'));
  document.head.appendChild(script);
});

const initialOptions = {
  "client-id": clientId || "test",
  currency: "USD",
  intent: "capture",
  environment: isLive ? "production" : "sandbox",
};

function App() {
  const [currentView, setCurrentView] = useState('home');
  const [pricingTab, setPricingTab] = useState('packages');
  const [sliderIndex, setSliderIndex] = useState(0);
  const [isPro, setIsPro] = useState(false);
  const [file, setFile] = useState(null);
  const [targetFormat, setTargetFormat] = useState('JPG');
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, uploading, processing, finished
  const [progress, setProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [isYearly, setIsYearly] = useState(false);
  const [selectedTierForCheckout, setSelectedTierForCheckout] = useState(null);
  const [userCredits, setUserCredits] = useState(0);
  const [preparedOrderId, setPreparedOrderId] = useState(null);
  const [isPreparingPayment, setIsPreparingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [googleClientId, setGoogleClientId] = useState(DEFAULT_GOOGLE_CLIENT_ID);

  const activeUserId = currentUser?.id || 'user_1';

  const fetchUserCredits = async (userId = activeUserId) => {
    try {
      const res = await fetch(apiUrl(`/api/user/${userId}`));
      const data = await res.json();
      if (data.credits !== undefined) {
        setUserCredits(data.credits);
      }
    } catch (e) {
      console.error('Failed to fetch credits');
    }
  };


  const refreshActiveUser = async () => {
    const savedUserId = localStorage.getItem('swiftconvert_user_id');
    if (!savedUserId) {
      fetchUserCredits('user_1');
      return;
    }

    try {
      const response = await fetch(apiUrl(`/api/auth/me/${savedUserId}`));
      if (!response.ok) throw new Error('User not found');
      const data = await response.json();
      setCurrentUser(data.user);
      setUserCredits(data.user.credits || 0);
    } catch {
      localStorage.removeItem('swiftconvert_user_id');
      setCurrentUser(null);
      fetchUserCredits('user_1');
    }
  };

  useEffect(() => {
    fetch(apiUrl('/api/config'))
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((config) => setGoogleClientId(config.googleClientId || DEFAULT_GOOGLE_CLIENT_ID))
      .catch(() => setGoogleClientId(DEFAULT_GOOGLE_CLIENT_ID));
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const googleUser = urlParams.get('googleUser');
    const authErrorParam = urlParams.get('authError');
    const success = urlParams.get('success');
    const token = urlParams.get('token');
    const amount = urlParams.get('amount');

    if (googleUser) {
      localStorage.setItem('swiftconvert_user_id', googleUser);
      fetch(apiUrl(`/api/auth/me/${googleUser}`))
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((data) => {
          setCurrentUser(data.user);
          setUserCredits(data.user.credits || 0);
        })
        .catch(() => localStorage.removeItem('swiftconvert_user_id'));
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (authErrorParam) {
      setAuthMode('signin');
      setAuthError(authErrorParam);
      setIsAuthOpen(true);
      window.history.replaceState(null, '', window.location.pathname);
      refreshActiveUser();
      return;
    }

    refreshActiveUser();
    
    if (success === 'true' && token && amount) {
      const paymentUserId = localStorage.getItem('swiftconvert_user_id') || activeUserId;
      fetch(apiUrl(`/api/orders/${token}/capture`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: paymentUserId, creditsPurchased: parseInt(amount, 10) })
      }).then(res => res.json()).then(data => {
        if (data.status === 'COMPLETED') {
          alert('Payment successful!');
          fetchUserCredits(paymentUserId);
          setIsPro(true);
          window.history.replaceState(null, '', window.location.pathname);
        } else {
          alert('Payment capture failed: ' + (data.error || 'Unknown error'));
        }
      }).catch(e => alert('Payment failed: ' + e.message));
    }
  }, []);


  useEffect(() => {
    if (currentView !== 'checkout' || !selectedTierForCheckout) return;

    let isCancelled = false;
    const amount = isYearly
      ? (selectedTierForCheckout.price * 12 * 0.8).toFixed(2)
      : selectedTierForCheckout.price.toString();

    setPreparedOrderId(null);
    setPaymentError(null);
    setIsPreparingPayment(true);

    fetch(apiUrl('/api/orders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount })
    })
      .then(async (response) => {
        const orderData = await response.json();
        if (!response.ok || !orderData.id) {
          throw new Error(orderData.error || 'Failed to prepare PayPal order');
        }
        if (!isCancelled) setPreparedOrderId(orderData.id);
      })
      .catch((error) => {
        if (!isCancelled) setPaymentError(error.message || 'Failed to prepare PayPal order');
      })
      .finally(() => {
        if (!isCancelled) setIsPreparingPayment(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [currentView, selectedTierForCheckout, isYearly]);

  const openAuth = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setIsAuthOpen(true);
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');

    try {
      const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(apiUrl(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      setCurrentUser(data.user);
      setUserCredits(data.user.credits || 0);
      localStorage.setItem('swiftconvert_user_id', data.user.id);
      setIsAuthOpen(false);
      setAuthForm({ name: '', email: '', password: '' });
    } catch (error) {
      setAuthError(error.message || 'Authentication failed');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('swiftconvert_user_id');
    fetchUserCredits('user_1');
  };

  const handleGoogleAuth = () => {
    setAuthError('');
    window.location.href = apiUrl('/api/auth/google');
  };
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [options, setOptions] = useState({
    audioCodec: 'copy',
    audioBitrate: '128',
    channels: 'stereo',
    sampleRate: '44100',
    volume: '100%',
    trimStart: '',
    trimEnd: ''
  });

  const fileInputRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (selectedFile) => {
    setFile(selectedFile);
    setStatus('idle');
    setProgress(0);
    setDownloadUrl(null);
    let defaultFmt = 'JPG';
    if (selectedFile.type.startsWith('audio/')) defaultFmt = 'MP3';
    if (selectedFile.type.startsWith('video/')) defaultFmt = 'MP4';
    if (selectedFile.type === 'application/pdf') defaultFmt = 'DOCX';
    setTargetFormat(defaultFmt);
  };

  const startConversion = async () => {
    setStatus('uploading');
    
    // Fake progress for UI
    let fakeProgress = 10;
    const progressInterval = setInterval(() => {
      if (fakeProgress < 90) {
        fakeProgress += 5;
        setProgress(fakeProgress);
      }
    }, 400);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetFormat', targetFormat);
      formData.append('userId', activeUserId);
      
      const response = await fetch(apiUrl('/api/convert'), {
        method: 'POST',
        body: formData
      });
      
      clearInterval(progressInterval);
      setProgress(95);
      setStatus('processing');
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Server error');
      }
      
      setProgress(100);
      setStatus('finished');
      setDownloadUrl(data.downloadUrl);
      fetchUserCredits();

    } catch (err) {
      clearInterval(progressInterval);
      console.error(err);
      if (err.message && err.message.includes('Insufficient credits')) {
        alert('Insufficient credits. Please purchase a package to continue converting files.');
        setCurrentView('pricing');
      } else {
        alert('Conversion Error: ' + err.message + '\n\nMake sure the Node.js server is running and your API key is valid!');
      }
      setStatus('idle');
      setProgress(0);
    }
  };

  const filteredFormats = ALL_FORMATS.filter(fmt => 
    fmt.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    fmt.category.toLowerCase().includes(searchQuery.toLowerCase())
  ).slice(0, 30);

  const groupedFormats = filteredFormats.reduce((acc, fmt) => {
    if (!acc[fmt.category]) acc[fmt.category] = [];
    acc[fmt.category].push(fmt);
    return acc;
  }, {});

  const packagesData = [
    { mins: 500, price: 9, maxFileSize: '1 GB', maxPerTask: 5 },
    { mins: 1000, price: 17, maxFileSize: '2 GB', maxPerTask: 10 },
    { mins: 2000, price: 30, maxFileSize: '5 GB', maxPerTask: 25 },
    { mins: 5000, price: 65, maxFileSize: '5 GB', maxPerTask: 50 },
    { mins: 10000, price: 115, maxFileSize: '5 GB', maxPerTask: 100 },
  ];

  const subscriptionsData = [
    { mins: 1000, price: 9, maxFileSize: '2 GB', maxPerTask: 10 },
    { mins: 2000, price: 17, maxFileSize: '5 GB', maxPerTask: 25 },
    { mins: 5000, price: 35, maxFileSize: '5 GB', maxPerTask: 50 },
    { mins: 10000, price: 65, maxFileSize: '5 GB', maxPerTask: 100 },
    { mins: 25000, price: 140, maxFileSize: '5 GB', maxPerTask: 250 },
  ];

  const currentTiers = pricingTab === 'packages' ? packagesData : subscriptionsData;
  const currentTier = currentTiers[Math.min(sliderIndex, currentTiers.length - 1)];

  return (
    <PayPalScriptProvider options={initialOptions}>
      <div className="app-container">
      <header className="header">
        <div className="header-left">
          <div className="logo" onClick={() => setCurrentView('home')} style={{ cursor: 'pointer' }}>
            <img src="/logo.png" alt="SpectraConvert Logo" className="logo-icon" style={{ width: '32px', height: '32px', borderRadius: '6px' }} />
            <span>Spectra<strong>Convert</strong></span>
          </div>
          <nav className="nav-links">
            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentView('home'); }}>Tools <ChevronDown size={14} style={{display:'inline', marginLeft: '4px', verticalAlign: 'middle'}}/></a>
            <a href="#" onClick={(e) => { e.preventDefault(); setCurrentView('pricing'); }}>Pricing</a>
          </nav>
        </div>
        <div className="header-right">
          <div style={{ marginRight: '1rem', fontWeight: '700', color: 'var(--primary-color)', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Zap size={18} /> {userCredits} Credits
          </div>
          {currentUser ? (
            <div className="account-menu">
              <span className="account-name">{currentUser.name}</span>
              <button className="btn btn-ghost icon-btn" onClick={handleLogout} title="Sign out"><LogOut size={16} /></button>
            </div>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => openAuth('signin')}>Sign in</button>
              <button className="btn btn-primary" onClick={() => openAuth('signup')}>Sign up</button>
            </>
          )}
        </div>
      </header>

      <main className="main-content">
        {currentView === 'home' ? (
          <>
            <section className="hero">
              <div className="hero-content">
                <h1>Transform Your Files</h1>
                <p>Experience lightning-fast conversions across audio, video, documents, and images. Sign in or create an account to unlock 10 free credits.</p>
              </div>
            </section>

            <div className="ad-container" style={{ textAlign: 'center', margin: '20px auto', width: '100%', maxWidth: '728px' }}>
              <iframe src="/ad-desktop.html" width="728" height="90" frameBorder="0" scrolling="no" className="desktop-ad"></iframe>
              <iframe src="/ad-mobile.html" width="320" height="50" frameBorder="0" scrolling="no" className="mobile-ad"></iframe>
            </div>


        {!file && (
          <div className="uploader-wrapper">
            <div 
              className={`uploader-card ${isDragging ? 'drag-active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input 
                type="file" 
                ref={fileInputRef}
                style={{ display: 'none' }} 
                onChange={(e) => {
                  if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
                }} 
              />
              <button className="btn btn-primary btn-large" onClick={() => fileInputRef.current?.click()}>
                Select File <ChevronDown size={20} />
              </button>
              
              <div className="upload-options">
                <div className="upload-option"><UploadCloud size={16} /> From Computer</div>
                <div className="upload-option"><LinkIcon size={16} /> By URL</div>
                <div className="upload-option"><HardDrive size={16} /> From Google Drive</div>
              </div>
            </div>
          </div>
        )}

        {file && (
          <div className="conversion-panel">
            <div className="conversion-item">
              <div className="file-info">
                <div className="file-icon">
                  <FileImage size={24} />
                </div>
                <div className="file-details">
                  <h3>{file.name}</h3>
                  <p>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              
              <div className="conversion-settings">
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>to</span>
                
                <div className="custom-dropdown-container" ref={dropdownRef}>
                  <button 
                    className="format-select-btn" 
                    onClick={() => status === 'idle' && setIsDropdownOpen(!isDropdownOpen)}
                    disabled={status !== 'idle'}
                  >
                    {targetFormat} <ChevronDown size={14} />
                  </button>
                  
                  {isDropdownOpen && (
                    <div className="custom-dropdown-menu">
                      <div className="search-box">
                        <Search size={14} color="var(--text-secondary)" />
                        <input 
                          type="text" 
                          placeholder="Search Format" 
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="format-grid-container" style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                        {Object.entries(groupedFormats).map(([category, formats]) => (
                          <div key={category} style={{ marginBottom: '1.5rem' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.75rem', letterSpacing: '0.05em', paddingLeft: '0.25rem' }}>
                              {category}
                            </div>
                            <div className="format-grid" style={{ maxHeight: 'none', overflowY: 'visible', paddingRight: 0 }}>
                              {formats.map(fmt => (
                                <button 
                                  key={fmt.name} 
                                  className={`format-grid-item ${targetFormat === fmt.name ? 'active' : ''}`}
                                  onClick={() => {
                                    setTargetFormat(fmt.name);
                                    setIsDropdownOpen(false);
                                    setSearchQuery('');
                                  }}
                                >
                                  {fmt.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  className="btn btn-ghost options-btn" 
                  onClick={() => setIsModalOpen(true)}
                  disabled={status !== 'idle'}
                >
                  <Settings size={18} /> Options
                </button>
              </div>
              
              <div className="actions">
                {status === 'idle' && (
                  <button className="btn btn-ghost" onClick={() => setFile(null)}>
                    Cancel
                  </button>
                )}
                {status === 'finished' && downloadUrl ? (
                  <>
                    <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="download-btn">
                      <Download size={18} /> Download
                    </a>
                    <button className="close-btn" style={{ width: '42px', height: '42px', backgroundColor: 'var(--surface-color)' }} onClick={() => setFile(null)}>
                      <X size={20} />
                    </button>
                  </>
                ) : status === 'idle' ? (
                  <MoreVertical size={20} color="var(--text-secondary)" style={{margin: 'auto 0'}} />
                ) : status === 'processing' ? (
                  <RefreshCw size={20} className="processing-icon" color="var(--primary-color)" />
                ) : status === 'uploading' ? (
                  <UploadCloud size={20} color="var(--text-secondary)" />
                ) : null}
              </div>
            </div>
            
            {status !== 'idle' && (
              <div style={{ padding: '0 1rem' }}>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="status-text">
                  {status === 'uploading' ? `Uploading... ${progress}%` : 
                   status === 'processing' ? 'Processing...' : 
                   'Finished'}
                </div>
              </div>
            )}
            
            {status === 'idle' && (
               <div className="btn-convert-wrapper">
                 <button className="btn btn-convert" onClick={startConversion}>
                   Convert
                 </button>
               </div>
            )}
          </div>
        )}

        <section className="features">
          <div className="feature">
            <div className="feature-icon"><Cloud size={32} /></div>
            <h3>200+ Formats Supported</h3>
            <p>We support nearly all audio, video, document, ebook, archive, image, spreadsheet, and presentation formats.</p>
          </div>
          <div className="feature">
            <div className="feature-icon"><CheckCircle size={32} /></div>
            <h3>High-Quality Conversions</h3>
            <p>Our open-source software partners guarantee the best possible conversion results for your files.</p>
          </div>
            <div className="feature">
              <div className="feature-icon"><Wrench size={32} /></div>
              <h3>Powerful API</h3>
              <p>The SpectraConvert API offers full integration with your app, allowing you to convert files directly from your backend.</p>
            </div>
          </section>
        </>
        ) : currentView === 'pricing' || (currentView !== 'checkout' && currentView !== 'home') ? (
          <section className="pricing-section">
            <div className="hero-content" style={{ marginBottom: '3rem' }}>
              <h1>Simple, transparent pricing</h1>
              <p>Choose the plan that fits your needs. No hidden fees.</p>
            </div>
            
            <div className="pricing-calculator">
              <div className="tab-switcher">
                <button 
                  className={`tab-btn ${pricingTab === 'packages' ? 'active' : ''}`}
                  onClick={() => { setPricingTab('packages'); setSliderIndex(0); }}
                >
                  Packages (One-Time)
                </button>
                <button 
                  className={`tab-btn ${pricingTab === 'subscriptions' ? 'active' : ''}`}
                  onClick={() => { setPricingTab('subscriptions'); setSliderIndex(0); }}
                >
                  Subscriptions (Monthly)
                </button>
              </div>

              <div className="slider-container">
                <div className="slider-header">
                  <span className="slider-label">Conversion Minutes {pricingTab === 'subscriptions' ? '/ month' : ''}</span>
                  <span className="slider-value">{currentTier.mins.toLocaleString()} mins</span>
                </div>
                <input 
                  type="range" 
                  className="neumorphic-slider"
                  min="0" 
                  max={currentTiers.length - 1} 
                  value={Math.min(sliderIndex, currentTiers.length - 1)} 
                  onChange={(e) => setSliderIndex(parseInt(e.target.value))}
                />
              </div>

              <div className="calculator-results">
                <div className="price-display">
                  <div className="price">${currentTier.price}</div>
                  <div className="price-subtext">
                    {pricingTab === 'packages' ? 'one-time payment' : 'per month'}
                  </div>
                </div>
                
                <div className="features-col">
                  <ul className="features-list">
                    <li><Check size={16} color="var(--primary-color)" /> Max file size: {currentTier.maxFileSize}</li>
                    <li><Check size={16} color="var(--primary-color)" /> Max {currentTier.maxPerTask} concurrent conversions</li>
                    <li><Check size={16} color="var(--primary-color)" /> High priority processing</li>
                    <li><Check size={16} color="var(--primary-color)" /> Full API Access</li>
                  </ul>
                  <div style={{ marginTop: '2rem' }}>
                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%', padding: '12px', fontSize: '1.1rem' }}
                      onClick={() => {
                        setSelectedTierForCheckout(currentTier);
                        setCurrentView('checkout');
                      }}
                    >
                      Checkout Now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : currentView === 'checkout' && selectedTierForCheckout ? (
          <section className="checkout-section">
            <div className="checkout-container">
              <div className="checkout-left" style={{ width: '100%' }}>
                <h2>Choose a payment method</h2>

                
                <div className="ssl-notice">
                  <Lock size={14} color="#888" />
                  <span>All transactions are SSL encrypted.</span>
                </div>
                
                <div className="total-due" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', marginTop: '1.5rem', fontWeight: 'bold' }}>
                  <span className="total-label" style={{ color: '#1a202c' }}>Total due:</span>
                  <span className="total-amount">${isYearly ? (selectedTierForCheckout.price * 12 * 0.8).toFixed(2) : selectedTierForCheckout.price} USD</span>
                </div>
                


                <div className="paypal-container">
                  {isPreparingPayment && (
                    <div className="payment-status">Preparing secure payment...</div>
                  )}
                  {paymentError && (
                    <div className="payment-status payment-error">{paymentError}</div>
                  )}
                  {preparedOrderId && !isPreparingPayment && !paymentError && (
                    <PayPalButtons 
                      key={`${preparedOrderId}-${isYearly ? 'yearly' : 'monthly'}`}
                      fundingSource="paypal"
                      style={{ layout: "vertical", color: "gold", shape: "rect", tagline: false }}
                      createOrder={async () => preparedOrderId}
                      onError={(error) => {
                        console.error('PayPal checkout failed', error);
                        setPaymentError('PayPal checkout failed. Please try again.');
                      }}
                      onApprove={async (data, actions) => {
                        try {
                          const amount = isYearly ? selectedTierForCheckout.mins * 12 : selectedTierForCheckout.mins;
                          const res = await fetch(apiUrl(`/api/orders/${data.orderID}/capture`), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: activeUserId, creditsPurchased: amount })
                          });
                          const serverData = await res.json();
                          if(serverData.status === "COMPLETED") {
                            alert(`Payment successful!`);
                            const savedUserId = localStorage.getItem('swiftconvert_user_id');
    if (savedUserId) {
      fetch(apiUrl(`/api/auth/me/${savedUserId}`))
        .then((res) => res.ok ? res.json() : Promise.reject())
        .then((data) => {
          setCurrentUser(data.user);
          setUserCredits(data.user.credits || 0);
        })
        .catch(() => localStorage.removeItem('swiftconvert_user_id'));
    } else {
      fetchUserCredits('user_1');
    }
                            setIsPro(true);
                            setCurrentView('home');
                          } else {
                            alert(`Payment capture failed: ${serverData.error || 'Payment not completed'}`);
                          }
                        } catch(e) {
                          alert('Payment capture failed: ' + e.message);
                        }
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="checkout-right" style={{ width: '100%' }}>
                <h3 className="section-title">Your Plan</h3>
                <div className="plan-card">
                  <div className="plan-row">
                    <span className="plan-label">Package</span>
                    <span className="plan-value credits"><Zap size={14} fill="currentColor"/> {selectedTierForCheckout.mins} credits</span>
                  </div>
                  <div className="plan-row">
                    <span className="plan-label">Billed</span>
                    <span className="plan-value">{isYearly ? 'Yearly' : pricingTab === 'packages' ? 'One-time' : 'Monthly'}</span>
                  </div>
                  <div className="plan-row total">
                    <span className="plan-label">Due today</span>
                    <span className="plan-value">${isYearly ? (selectedTierForCheckout.price * 12 * 0.8).toFixed(2) : selectedTierForCheckout.price} USD</span>
                  </div>
                  
                  <div className="plan-guarantees">
                    <div className="guarantee-item">
                      <ShieldCheck size={16} color="var(--success-color)" /> Secure payment
                    </div>
                    <div className="guarantee-item">
                      <ShieldCheck size={16} color="var(--success-color)" /> Full money-back guarantee
                    </div>
                  </div>
                </div>

                {pricingTab === 'subscriptions' && (
                  <>
                    <h3 className="section-title" style={{marginTop: '2rem'}}>Save up to 20% now</h3>
                    <div className="upsell-card">
                      <label className="upsell-label">
                        <input 
                          type="checkbox" 
                          checked={isYearly}
                          onChange={(e) => setIsYearly(e.target.checked)}
                        />
                        <span className="upsell-title">Pay yearly and save</span>
                        <span className="upsell-badge">Save ${(selectedTierForCheckout.price * 12 * 0.2).toFixed(2)} USD</span>
                      </label>
                      <p className="upsell-text">Choose annual billing to save more and pay less overall.</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {isAuthOpen && (
        <div className="modal-overlay auth-modal">
          <div className="modal-content auth-content">
            <div className="modal-header">
              <div className="auth-heading">
                <h2>{authMode === 'signup' ? 'Create account' : 'Sign in'}</h2>
                <p className="auth-note">Sign in or create an account to unlock 10 free credits.</p>
              </div>
              <button className="close-btn" onClick={() => setIsAuthOpen(false)}><X size={20} /></button>
            </div>
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'signup' && (
                <label>
                  Name
                  <input
                    value={authForm.name}
                    onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })}
                    placeholder="Your name"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
              </label>
              {authError && <div className="auth-error">{authError}</div>}
              <button className="btn btn-primary auth-submit" type="submit">
                {authMode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
              <button className="btn google-btn" type="button" onClick={handleGoogleAuth}>
                Continue with Google
              </button>
              <button
                className="auth-switch"
                type="button"
                onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setAuthError(''); }}
              >
                {authMode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create account'}
              </button>
            </form>
          </div>
        </div>
      )}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Options</h2>
              <button className="close-btn" onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <h3 className="section-title">Audio</h3>
              
              <div className="form-grid">
                <div className="form-group">
                  <label>Audio Codec</label>
                  <select 
                    value={options.audioCodec}
                    onChange={(e) => setOptions({...options, audioCodec: e.target.value})}
                  >
                    <option value="copy">copy</option>
                    <option value="pcm_s16le">pcm_s16le</option>
                    <option value="aac">aac</option>
                    <option value="libmp3lame">libmp3lame (mp3)</option>
                  </select>
                  <span className="help-text">Codec to encode the audio. Use "copy" to copy the stream without re-encoding.</span>
                </div>
                
                <div className="form-group">
                  <label>Audio Bitrate</label>
                  <input 
                    type="text" 
                    value={options.audioBitrate}
                    onChange={(e) => setOptions({...options, audioBitrate: e.target.value})}
                  />
                  <span className="help-text">Audio bitrate (e.g. 128 for 128k).</span>
                </div>

                <div className="form-group">
                  <label>Channels</label>
                  <select 
                    value={options.channels}
                    onChange={(e) => setOptions({...options, channels: e.target.value})}
                  >
                    <option value="stereo">stereo</option>
                    <option value="mono">mono</option>
                    <option value="5.1">5.1</option>
                  </select>
                  <span className="help-text">Convert the audio to mono or stereo.</span>
                </div>

                <div className="form-group">
                  <label>Volume</label>
                  <select 
                    value={options.volume}
                    onChange={(e) => setOptions({...options, volume: e.target.value})}
                  >
                    <option value="100%">100%</option>
                    <option value="150%">150%</option>
                    <option value="200%">200%</option>
                    <option value="50%">50%</option>
                  </select>
                  <span className="help-text">Increase or reduce the audio volume.</span>
                </div>
              </div>

              <div className="form-group full-width" style={{marginTop: '1rem'}}>
                <label>Sample Rate</label>
                <select 
                  value={options.sampleRate}
                  onChange={(e) => setOptions({...options, sampleRate: e.target.value})}
                >
                  <option value="44100">44100</option>
                  <option value="48000">48000</option>
                  <option value="96000">96000</option>
                </select>
                <span className="help-text">Set the audio sampling frequency.</span>
              </div>

              <h3 className="section-title" style={{marginTop: '2rem'}}>Trim</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label>Trim Start</label>
                  <input 
                    type="text" 
                    placeholder="HH:MM:SS"
                    value={options.trimStart}
                    onChange={(e) => setOptions({...options, trimStart: e.target.value})}
                  />
                  <span className="help-text">Trim start timestamp (HH:MM:SS)</span>
                </div>
                <div className="form-group">
                  <label>Trim End</label>
                  <input 
                    type="text" 
                    placeholder="HH:MM:SS"
                    value={options.trimEnd}
                    onChange={(e) => setOptions({...options, trimEnd: e.target.value})}
                  />
                  <span className="help-text">Trim end timestamp (HH:MM:SS)</span>
                </div>
              </div>

            </div>
            
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setIsModalOpen(false)}>Okay <ChevronDown size={14} style={{marginLeft: '4px'}}/></button>
            </div>
          </div>
        </div>
      )}
      </div>
    </PayPalScriptProvider>
  );
}

export default App;
