import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './member.css';

// 各メンバーのデータに実際の情報を反映しました
const membersData = [
  {
    id: "member1",
    subtitle: "NICKNAME",
    nickname: "黒糖",
    image: "/member1.jpg",
    gender: "女性",
    region: "東京都",
    age: "20代",
    grade: "3年",
    credits: "55％ほど（2026.4時点）",
    career: "就職",
    qualifications: "なし",
    gakuchika: "外部のクラブ活動、アルバイト",
    studyStyle: "メディスク50%,対面40%,リポ単10%",
    reason: "初代中の人をはじめ、多くの方に支えられてきた経験があり、その恩返しとして今度は私が誰かの力になりたいと思ったため"
  },
  {
    id: "member2",
    subtitle: "NICKNAME",
    nickname: "Y",
    image: "/member2.jpg",
    gender: "男性",
    region: "東京都",
    age: "20代",
    grade: "2年",
    credits: "78単位",
    career: "大学院進学",
    qualifications: "英検準1級(都内上位1%)、日商簿記2級",
    gakuchika: "大学院進学に向けて専門分野の学習と資格取得",
    studyStyle: "メディスク・リポ単中心に履修しています",
    reason: "スケジュール管理が卒業の大きな障壁になる通信教育において、「法政通信メディア」の果たす役割は重要であり、初代中の人の卒業後も継続させたいと思ったため"
  },
  {
    id: "member3",
    subtitle: "NICKNAME",
    nickname: "W",
    image: "/member3.jpg",
    gender: "男性",
    region: "静岡県",
    age: "20代",
    grade: "2年",
    credits: "34(掲載時)",
    career: "未定",
    qualifications: "なし",
    gakuchika: "インターン",
    studyStyle: "メディスク&リポ単",
    reason: "運営メンバーである友人に、サイト制作を依頼されたため"
  }
];

const ProfileCard = () => {
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0);
  const currentMember = membersData[currentMemberIndex];

  return (
    <div className="member-page-wrapper">

      <div className="member-select-bar">
        {membersData.map((member, index) => (
          <button
            key={member.id}
            className={`select-btn ${index === currentMemberIndex ? 'active' : ''}`}
            onClick={() => setCurrentMemberIndex(index)}
          >
            メンバー {index + 1} ({member.nickname})
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={currentMemberIndex}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.25 }}
          className="profile-card"
        >
          <div className="line-top-left"></div>
          <div className="line-top-right"></div>
          <div className="line-left-top"></div>
          <div className="line-left-bottom"></div>
          <div className="line-right-bottom"></div>
          <div className="line-bottom-right"></div>

          <div className="title-area">
            <h1 className="title-text">自己紹介</h1>
            <div className="title-line-group">
              <div className="title-line-wide"></div>
              <div className="title-line-narrow"></div>
            </div>
          </div>

          <div className="card-body">

            <div className="left-column">

              <div className="avatar-circle">
                {currentMember.image ? (
                  <img src={currentMember.image} alt={currentMember.nickname} className="avatar-image" />
                ) : (
                  // 画像が設定されていない場合の予備表示
                  <div style={{ width: '100%', height: '100%', backgroundColor: '#d1d5db' }}></div>
                )}
              </div>

              <div className="name-separator">
                <div className="sep-blue"></div>
                <div className="sep-orange"></div>
              </div>

              <div className="member-name">{currentMember.nickname}</div>
              <div className="member-sub">{currentMember.subtitle}</div>
            </div>

            <div className="right-column">

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-orange">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2"></path>
                    <line x1="9" y1="9" x2="9.01" y2="9"></line>
                    <line x1="15" y1="9" x2="15.01" y2="9"></line>
                  </svg>
                </div>
                <div className="label-text">性 別</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.gender}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-blue">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                    <circle cx="12" cy="10" r="3"></circle>
                  </svg>
                </div>
                <div className="label-text">地 域</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.region}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-orange">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                </div>
                <div className="label-text">年 齢</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.age}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-blue">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path>
                  </svg>
                </div>
                <div className="label-text">学 年</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.grade}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-orange">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
                    <path d="M6 12.5v5c3 3 9 3 12 0v-5"></path>
                  </svg>
                </div>
                <div className="label-text">単 位</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.credits}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-blue">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                  </svg>
                </div>
                <div className="label-text">進 路 状 況</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.career}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-orange">
                    <circle cx="12" cy="8" r="7"></circle>
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                  </svg>
                </div>
                <div className="label-text">資格の状況</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.qualifications}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-blue">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </div>
                <div className="label-text">ガクチカ</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.gakuchika}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-orange">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </div>
                <div className="label-text">履修スタイル</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.studyStyle}</div>
              </div>

              <div className="detail-item">
                <div className="icon-wrapper">
                  <svg viewBox="0 0 24 24" className="icon-svg-blue">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <div className="label-text">運営に入った理由</div>
                <div className="vertical-divider">|</div>
                <div className="value-text">{currentMember.reason}</div>
              </div>

            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default ProfileCard;