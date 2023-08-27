
const jwt = require('jsonwebtoken')

const { User, Tweet, Reply, Like, Followship, sequelize } = require('../models')

const adminController = {
  // No.20 - 登入後台帳號 POST /api/admin/signin
  signIn: (req, res, next) => {
    try {
      const userData = req.user.toJSON()
      // 角色若不是admin則不發給token
      if (userData.role !== 'admin') throw new Error('no such user(角色錯誤)', { cause: { accountErrMsg: '帳號不存在！', passwordErrMsg: '' } })

      delete userData.password
      const token = jwt.sign(userData, process.env.JWT_SECRET, { expiresIn: '30d' }) // 簽發 JWT，效期為 30 天

      return res.status(200).json({
        success: true,
        data: { token, user: userData }
      })
    } catch (err) {
      return next(err)
    }
  },
  // No.21 - 取得所有使用者清單 GET /api/admin/users
  getUsers: async (req, res, next) => {
    try {
      // --資料提取--
      const users = await User.findAll({
        // where: { role: 'user' }, // 測試檔清單不排除admin
        attributes: {
          exclude: ['password'],
          include: [[
            sequelize.literal('(SELECT COUNT(*) FROM Tweets WHERE Tweets.UserId = User.id)'),
            'tweetsNum'
          ], [
            sequelize.literal('(SELECT COUNT(*) FROM Likes JOIN Tweets on Likes.TweetId = Tweets.id WHERE Tweets.UserId = User.id)'),
            'likesNum'
          ], [
            sequelize.literal('(SELECT COUNT(*) FROM Followships WHERE followerId = User.id)'),
            'followingsNum'
          ], [
            sequelize.literal('(SELECT COUNT(*) FROM Followships WHERE followingId = User.id)'),
            'followersNum'
          ]]
        },
        order: [
          [sequelize.literal('tweetsNum'), 'DESC'],
          [sequelize.literal('likesNum'), 'DESC'],
          [sequelize.literal('followersNum'), 'DESC'],
          [sequelize.literal('followingsNum'), 'DESC']
        ],
        nest: true,
        raw: true
      })

      // --資料整理-- (此處不需整理，提供實際數字，前端可自行用numeral.js等套件格式化)

      return res.status(200).json(users)
    } catch (err) {
      return next(err)
    }
  },
  // No.22 - 取得所有推文清單 GET /api/admin/tweets
  getTweets: (req, res, next) => {
    try {
      return res.status(200).json({})
    } catch (err) {
      return next(err)
    }
  },
  // No.23 - 刪除特定推文 DELETE /api/admin/tweets/:id
  deleteTweet: (req, res, next) => {
    try {
      return res.status(200).json({})
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = adminController
