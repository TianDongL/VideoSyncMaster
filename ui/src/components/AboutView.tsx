import React from 'react';

interface AboutViewProps {
    themeMode?: 'light' | 'dark' | 'gradient';
}

const AboutView: React.FC<AboutViewProps> = ({ themeMode }) => {
    const isLightMode = themeMode === 'gradient' || themeMode === 'light';

    return (
        <div className="glass-panel" style={{
            height: '100%',
            overflowY: 'auto',
            padding: '40px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
        }}>
            <div style={{ width: '100%', maxWidth: '700px', textAlign: 'center' }}>
                <h1 style={{ marginBottom: '20px', fontSize: '2.5em', color: isLightMode ? '#1e293b' : '#fff' }}>
                    关于
                </h1>

                <div style={{
                    background: isLightMode ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.15)',
                    padding: '30px',
                    borderRadius: '20px',
                    marginBottom: '40px',
                    border: '1px solid rgba(99, 102, 241, 0.2)'
                }}>
                    <p style={{ fontSize: '1.2em', fontWeight: 'bold', margin: '0 0 10px 0' }}>VideoSyncMaster</p>
                    <p style={{ fontSize: '0.9em', color: isLightMode ? '#64748b' : '#94a3b8', margin: '0 0 20px 0' }}>
                        Version: v1.0.0
                    </p>
                    <p style={{ lineHeight: '1.6', margin: 0 }}>
                        VideoSyncMaster 是一款强大的视频同步与翻译工具，旨在帮助用户高效地完成视频字幕提取、翻译以及多语言配音工作。
                    </p>
                </div>


                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', fontSize: '0.85em', color: isLightMode ? '#64748b' : '#94a3b8' }}>
                    <p>© 2026 VideoSyncMaster. Developed by 天冬 (TianDong)</p>
                </div>
            </div>
        </div>
    );
};

export default AboutView;
