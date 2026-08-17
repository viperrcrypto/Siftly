import { describe, expect, it } from 'vitest'
import { galleryDlArgs, galleryTweetsFromDataJobs } from '@/lib/archive/gallery-dl'

function graphqlTweet(id: string, authorId: string, handle: string, legacy: Record<string, unknown>) {
  const tweet = { rest_id: id, legacy, core: { user_results: { result: { rest_id: authorId, legacy: { screen_name: handle } } } } }
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ entries: [{ content: { itemContent: { tweet_results: { result: tweet } } } }] }],
      },
    },
  }
}

describe('gallery-dl DataJob protocol', () => {
  it('実DataJobからroot photo・self GIF・quote videoだけを構造化する', () => {
    const root = graphqlTweet('9223372036854775807', '9007199254740993', 'root', {
      full_text: 'root', conversation_id_str: '9223372036854775807', extended_entities: { media: [{ type: 'photo', media_key: '3_photo', media_url_https: 'https://pbs.twimg.com/media/root.jpg' }] },
    })
    const self = graphqlTweet('9223372036854775806', '9007199254740993', 'root', {
      full_text: 'gif', conversation_id_str: '9223372036854775807', in_reply_to_status_id_str: '9223372036854775807', extended_entities: { media: [{ type: 'animated_gif', id_str: '4_gif', video_info: { variants: [{ url: 'https://video.twimg.com/gif.mp4?tag=1' }] } }] },
    })
    const quote = graphqlTweet('9223372036854775805', '7', 'quoted', {
      full_text: 'quote', conversation_id_str: '9223372036854775807', quoted_status_id_str: '9', extended_entities: { media: [{ type: 'video', id_str: '5_video', video_info: { variants: [{ url: 'https://video.twimg.com/quote.mp4?tag=1' }] } }] },
    })
    const tweets = galleryTweetsFromDataJobs([
      [2, root], [3, 'https://pbs.twimg.com/media/root.jpg?format=jpg', root], [3, 'https://example.com/article', root],
      [2, self], [3, 'https://video.twimg.com/gif.mp4?tag=2', self], [3, 'https://pbs.twimg.com/media/preview.jpg', self],
      [2, quote], [3, 'https://video.twimg.com/quote.mp4?tag=2', quote],
    ])

    expect(tweets.map((tweet) => tweet.id)).toEqual(['9223372036854775807', '9223372036854775806', '9223372036854775805'])
    expect(tweets[0]).toMatchObject({ authorId: '9007199254740993', authorHandle: 'root', conversationId: '9223372036854775807', media: [{ type: 'photo', mediaKey: '3_photo', sourceMediaIndex: 0 }] })
    expect(tweets[1]).toMatchObject({ inReplyToId: '9223372036854775807', media: [{ type: 'animated_gif', mediaKey: '4_gif', sourceMediaIndex: 0 }] })
    expect(tweets[2]).toMatchObject({ quotedTweetId: '9', media: [{ type: 'video', mediaKey: '5_video', sourceMediaIndex: 0 }] })
  })

  it('実行設定で数値文字列化と不要な出力の除外を固定する', () => {
    expect(galleryDlArgs()).toEqual(expect.arrayContaining(['-j', 'output.num-to-str=true', 'extractor.twitter.transform=false', 'extractor.twitter.videos=true', 'extractor.twitter.previews=false', 'extractor.twitter.articles=false', 'extractor.twitter.cards=false']))
  })

  it('pbs.twimgの動画previewを同一metadataのvideo.twimg MP4へ昇格する', () => {
    const video = graphqlTweet('1', '2', 'root', {
      full_text: 'video', conversation_id_str: '1', extended_entities: { media: [{ type: 'video', id_str: 'video-1', media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/a.jpg', video_info: { variants: [{ url: 'https://video.twimg.com/ext_tw_video/a.m3u8' }, { url: 'https://video.twimg.com/ext_tw_video/low.mp4?tag=1', bit_rate: 832000 }, { url: 'https://video.twimg.com/ext_tw_video/high.mp4?tag=1', bitrate: '2176000' }] } }] },
    })
    expect(galleryTweetsFromDataJobs([[2, video], [3, 'https://pbs.twimg.com/ext_tw_video_thumb/a.jpg?name=small', video]])[0].media).toEqual([{
      type: 'video', mediaKey: 'video-1', sourceMediaIndex: 0, url: 'https://video.twimg.com/ext_tw_video/high.mp4?tag=1',
    }])
  })
})
