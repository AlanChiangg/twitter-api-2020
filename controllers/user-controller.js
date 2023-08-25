const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const dayjs = require('dayjs')
const relativeTime = require('dayjs/plugin/relativeTime')
dayjs.extend(relativeTime) // 外掛相對時間模組
require('dayjs/locale/zh-tw')
dayjs.locale('zh-tw') // 默認使用繁中

const helpers = require('../_helpers')
const { User, Tweet, Reply, Like, sequelize } = require('../models')

const userController = {
  // No.1 - 註冊帳號 POST /api/users
  signUp: async (req, res, next) => {
    try {
      const { account, name, email, password, checkPassword, introduction, avatar, banner } = req.body
      const cause = { // 定義不同的錯誤訊息，以便前端顯示之用
        accountErrMsg: '',
        nameErrMsg: '',
        emailErrMsg: '',
        passwordErrMsg: '',
        checkPasswordErrMsg: ''
      }

      // 確認必填值是否為空
      if (!account) cause.accountErrMsg += 'account 為必填欄位。'
      if (!name) cause.nameErrMsg += 'name 為必填欄位。'
      if (!email) cause.emailErrMsg += 'email 為必填欄位。'
      if (!password) cause.passwordErrMsg += 'password 為必填欄位。'
      if (!checkPassword) cause.checkPasswordErrMsg += 'checkPassword 為必填欄位。'
      if (cause.accountErrMsg || cause.nameErrMsg || cause.emailErrMsg || cause.passwordErrMsg || cause.checkPasswordErrMsg) {
        throw new Error('Empty input value!', { cause })
      }

      // 確認checkPassword是否相符 & name是否在50字之內
      if (password !== checkPassword) cause.checkPasswordErrMsg += '確認密碼不相符。'
      if (name.length > 50) cause.nameErrMsg += '名稱不得超過50字。'

      // 確認account或email是否重複
      const [user1, user2] = await Promise.all([
        User.findOne({ where: { account } }),
        User.findOne({ where: { email } })
      ])
      if (user1) cause.accountErrMsg += 'account 已重複註冊！'
      if (user2) cause.emailErrMsg += 'email 已重複註冊！'

      if (cause.accountErrMsg || cause.nameErrMsg || cause.emailErrMsg || cause.passwordErrMsg || cause.checkPasswordErrMsg) {
        throw new Error('Inproper input value!', { cause })
      }

      // 若無錯誤則建立新帳號
      const hash = await bcrypt.hash(password, 10)
      const user = await User.create({
        account,
        name,
        email,
        password: hash,
        introduction: introduction || '',
        avatar: avatar || 'https://via.placeholder.com/224',
        banner: banner || 'https://images.unsplash.com/photo-1580436541340-36b8d0c60bae',
        role: 'user'
      })

      if (!user) throw new Error('建立帳號失敗！')
      req.user = user
      return next() // 先不回應，向後交給signin繼續處理

      // const userData = user.toJSON()
      // delete userData.password
      // return res.status(200).json({ success: true, data: userData })
    } catch (err) {
      return next(err)
    }
  },
  // No.2 - 登入前台帳號 POST /api/users/signin
  signIn: (req, res, next) => {
    try {
      const userData = req.user.toJSON()
      // 角色若不是user則不發給token
      if (userData.role !== 'user') throw new Error('no such user(角色錯誤)', { cause: { accountErrMsg: '帳號不存在！', passwordErrMsg: '' } })

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
  // No.3 - 查看某使用者的資料 GET /api/users/:id
  getUser: async (req, res, next) => {
    try {
      const UserId = req.params.id

      // --資料提取--
      const user = await User.findByPk(UserId, {
        where: { id: UserId },
        raw: true,
        nest: true,
        attributes: {
          include: [[ // 使用sequelize.literal把追蹤者、追隨者各做成一個屬性
            sequelize.literal(`(SELECT COUNT(*) FROM Followships WHERE followerId = ${UserId})`),
            'followingNum' // 追隨者總數
          ], [
            sequelize.literal(`(SELECT COUNT(*) FROM Followships WHERE followingId = ${UserId})`),
            'followerNum' // 追蹤者總數
          ]]
        }
      })
      delete user.password

      return res.status(200).json(user)
    } catch (err) {
      return next(err)
    }
  },
  // No.4 - 查看某使用者發過的推文 GET /api/users/:id/tweets
  getUserTweets: async (req, res, next) => {
    try {
      const UserId = req.params.id
      const currentUserId = helpers.getUser(req).id

      // --資料提取--
      let tweets = await Tweet.findAll({
        where: { UserId },
        order: [['createdAt', 'DESC']],
        include: [{
          model: User,
          attributes: ['account', 'name', 'avatar']
          // ,as: 'Author'
        }],
        nest: true,
        attributes: {
          include: [[
            sequelize.literal('(SELECT COUNT(*) FROM Replies WHERE TweetId = Tweet.id)'),
            'repliesNum' // 被回覆的總數
          ], [
            sequelize.literal('(SELECT COUNT(*) FROM Likes WHERE TweetId = Tweet.id)'),
            'likesNum' // 被喜歡的總數
          ], [
            // sequelize.literal(`(SELECT COUNT(*) FROM Likes WHERE TweetId = Tweet.id and UserId = ${currentUserId})`),
            sequelize.literal(`(SELECT EXISTS(SELECT * FROM Likes WHERE TweetId = Tweet.id and UserId = ${currentUserId}))`),
            'isLiked' // 目前使用者是否喜歡
          ]]
        }
      })

      // --資料整理--
      tweets = tweets.map(tweet => tweet.toJSON())
      tweets = tweets.map(tweet => ({
        ...tweet,
        isLiked: Boolean(tweet.isLiked),
        fromNow: dayjs(tweet.createdAt).fromNow()
      }))

      return res.status(200).json(tweets)
    } catch (err) {
      return next(err)
    }
  },
  // No.5 - 查看某使用者發過的回覆 GET /api/users/:id/replied_tweets
  getUserReplies: async (req, res, next) => {
    try {
      const UserId = req.params.id

      // --資料提取--
      let replies = await Reply.findAll({
        where: { UserId },
        order: [['createdAt', 'DESC']],
        include: [{
          model: User, // Reply的作者基本屬性
          attributes: ['account', 'name', 'avatar']
          // ,as: 'Author'
        }],
        attributes: {
          include: [[
            sequelize.literal('(SELECT account FROM Users WHERE UserId = Users.id)'),
            'repliedTo' // 回覆給那一個作者
          ]]
        },
        nest: true
      })

      // --資料整理--
      replies = replies.map(reply => reply.toJSON())
      replies = replies.map(reply => ({
        ...reply,
        fromNow: dayjs(reply.createdAt).fromNow()
      }))

      return res.status(200).json(replies)
    } catch (err) {
      return next(err)
    }
  },
  // No.6 - 查看某使用者點過like的推文 GET /api/users/:id/likes
  getUserLikes: async (req, res, next) => {
    try {
      const UserId = req.params.id

      // --資料提取--
      let likes = await Like.findAll({
        where: { UserId },
        order: [['createdAt', 'DESC']],
        include: [{
          model: Tweet,
          include: [{
            model: User,
            attributes: ['account', 'name', 'avatar']
            // ,as: 'Author'
          }],
          attributes: {
            include: [[
              sequelize.literal('(SELECT COUNT(*) FROM Replies WHERE TweetId = Tweet.id)'),
              'repliesNum' // 被回覆的總數
            ], [
              sequelize.literal('(SELECT COUNT(*) FROM Likes WHERE TweetId = Tweet.id)'),
              'likesNum' // 被喜歡的總數
            ]]
          }
        }],
        nest: true
      })

      // --資料整理--
      likes = likes.map(reply => reply.toJSON())
      likes = likes.map(reply => ({ // 追加兩個屬性fromNow & isLiked
        ...reply,
        Tweet: {
          ...reply.Tweet,
          fromNow: dayjs(reply.Tweet.createdAt).fromNow(),
          isLiked: true
        }
      }))

      return res.status(200).json(likes)
    } catch (err) {
      return next(err)
    }
  }
}

module.exports = userController
