package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/navidrome/navidrome/plugins/pdk/go/host"
	"github.com/navidrome/navidrome/plugins/pdk/go/pdk"
	"github.com/navidrome/navidrome/plugins/pdk/go/scrobbler"
)

const (
	configBridgeURL = "bridge_url"
	configCastDevice = "cast_device"
	configAutoCast = "auto_cast"
	defaultTimeout  = 3000
)

type castBridgePlugin struct{}

func init() {
	scrobbler.Register(&castBridgePlugin{})
}

func main() {}

func (p *castBridgePlugin) IsAuthorized(_ scrobbler.IsAuthorizedRequest) (bool, error) {
	return true, nil
}

func (p *castBridgePlugin) NowPlaying(input scrobbler.NowPlayingRequest) error {
	return postEvent("now_playing", input.Username, input.Track, 0, 1)
}

func (p *castBridgePlugin) Scrobble(input scrobbler.ScrobbleRequest) error {
	return postEvent("scrobble", input.Username, input.Track, 0, 1)
}

func (p *castBridgePlugin) PlaybackReport(input scrobbler.PlaybackReportRequest) error {
	return postEvent(input.State, input.Username, input.Track, input.PositionMs, input.PlaybackRate)
}

func postEvent(state, username string, track any, positionMs int64, playbackRate float64) error {
	bridgeURL, exists := host.ConfigGet(configBridgeURL)
	if !exists || strings.TrimSpace(bridgeURL) == "" {
		pdk.Log(pdk.LogWarn, "bridge_url is not configured; skipping Cast bridge event")
		return nil
	}

	payload := map[string]any{
		"state":         state,
		"username":      username,
		"track":         track,
		"positionMs":    positionMs,
		"playbackRate":  playbackRate,
		"source":        "navidrome-plugin",
		"pluginVersion": "0.1.0",
	}
	if castDevice, exists := host.ConfigGet(configCastDevice); exists && strings.TrimSpace(castDevice) != "" {
		payload["castDevice"] = castDevice
	}
	if autoCast, exists := host.ConfigGet(configAutoCast); exists && autoCast == "true" {
		payload["autoCast"] = true
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal playback event: %w", err)
	}

	url := strings.TrimRight(bridgeURL, "/") + "/plugin/playback"
	resp, err := host.HTTPSend(host.HTTPRequest{
		Method:    "POST",
		URL:       url,
		Headers:   map[string]string{"Content-Type": "application/json"},
		Body:      body,
		TimeoutMs: defaultTimeout,
	})
	if err != nil {
		pdk.Log(pdk.LogWarn, fmt.Sprintf("failed to send event to Cast bridge: %v", err))
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		pdk.Log(pdk.LogWarn, fmt.Sprintf("Cast bridge returned HTTP %d", resp.StatusCode))
	}

	return nil
}
